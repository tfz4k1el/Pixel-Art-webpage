const mapBaseWidth = 264;
const mapBaseHeight = 352;

const playerEl = document.getElementById('player');
const bgMap = document.getElementById('bg-map');
const canvas = document.getElementById('hitbox-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const popupEl = document.getElementById('popup-container');

canvas.width = mapBaseWidth;
canvas.height = mapBaseHeight;

let mapData = null;

// Wait for map image to load so we can draw it to canvas for pixel analysis
bgMap.onload = () => {
    try {
        ctx.drawImage(bgMap, 0, 0, mapBaseWidth, mapBaseHeight);
        mapData = ctx.getImageData(0, 0, mapBaseWidth, mapBaseHeight).data;
    } catch (e) {
        console.warn("Could not read map data (likely local file CORS). Collision will be disabled.", e);
        mapData = null;
    }
};

if (bgMap.complete) {
    bgMap.onload();
}

// Player state
let playerX = 132; // Center X
let playerY = 176; // Center Y
let playerSpeed = 1.2;
let currentDirection = 1; // 1 for right, -1 for left

// Keys
const keys = {
    w: false, a: false, s: false, d: false,
    ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false
};

let identityOpen = false;
let paperOpen = false;

window.addEventListener('keydown', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (keys.hasOwnProperty(key)) {
        keys[key] = true;
        // Prevent default scrolling for arrow keys
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
            e.preventDefault();
        }
    }
    
    // Handle Enter key for letter interaction
    if (e.key === 'Enter') {
        const isNearRock = popupEl.classList.contains('popup-visible');
        if (isNearRock && !identityOpen && !paperOpen) {
            identityOpen = true;
            document.getElementById('identity-modal').classList.add('popup-visible');
            // Slight delay before focus to allow transition
            setTimeout(() => document.getElementById('identity-input').focus(), 100);
        }
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (keys.hasOwnProperty(key)) {
        keys[key] = false;
    }
});

// Setup identity submit button
document.getElementById('identity-submit').addEventListener('click', () => {
    const val = document.getElementById('identity-input').value.trim().toLowerCase();
    if (val === 'chunnu') {
        document.getElementById('identity-modal').classList.remove('popup-visible');
        document.getElementById('paper-modal').classList.add('popup-visible');
        paperOpen = true;
    } else {
        alert("Incorrect identity. You cannot open this letter.");
        document.getElementById('identity-modal').classList.remove('popup-visible');
        identityOpen = false;
        document.getElementById('identity-input').value = '';
    }
});

// Setup close button for paper
document.getElementById('close-paper-btn').addEventListener('click', () => {
    document.getElementById('paper-modal').classList.remove('popup-visible');
    paperOpen = false;
    identityOpen = false; // Reset identity state so they can open it again if they want
});

// Setup popup tap interaction
popupEl.addEventListener('click', () => {
    if (popupEl.classList.contains('popup-visible') && !identityOpen && !paperOpen) {
        identityOpen = true;
        document.getElementById('identity-modal').classList.add('popup-visible');
        setTimeout(() => document.getElementById('identity-input').focus(), 100);
    }
});

// Virtual Joystick State
let isTouching = false;
let touchStartX = 0;
let touchStartY = 0;
let joystickVector = { x: 0, y: 0 };
const maxJoystickRadius = 35; // How far the stick can move from center

const joystickZone = document.getElementById('joystick-zone');
const joystickBase = document.getElementById('joystick-base');
const joystickStick = document.getElementById('joystick-stick');

function getRelativePos(e) {
    const rect = joystickZone.getBoundingClientRect();
    const touch = e.targetTouches ? e.targetTouches[0] : e;
    return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
    };
}

joystickZone.addEventListener('touchstart', (e) => {
    if (identityOpen || paperOpen) return;
    // Don't prevent default if clicking on popup (popup is above joystick, but just in case)
    if (e.target.closest('#popup-container')) return;
    
    e.preventDefault();
    isTouching = true;
    const pos = getRelativePos(e);
    touchStartX = pos.x;
    touchStartY = pos.y;
    
    joystickBase.style.left = `${pos.x}px`;
    joystickBase.style.top = `${pos.y}px`;
    joystickBase.classList.remove('joystick-hidden');
    
    joystickStick.style.transform = `translate(-50%, -50%)`;
    joystickVector = { x: 0, y: 0 };
}, { passive: false });

joystickZone.addEventListener('touchmove', (e) => {
    if (!isTouching || identityOpen || paperOpen) return;
    e.preventDefault();
    const pos = getRelativePos(e);
    let dx = pos.x - touchStartX;
    let dy = pos.y - touchStartY;
    
    const distance = Math.sqrt(dx*dx + dy*dy);
    if (distance > maxJoystickRadius) {
        dx = (dx / distance) * maxJoystickRadius;
        dy = (dy / distance) * maxJoystickRadius;
    }
    
    joystickStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    
    if (distance > 0) {
        // Normalize vector from 0 to 1
        joystickVector.x = dx / maxJoystickRadius;
        joystickVector.y = dy / maxJoystickRadius;
    } else {
        joystickVector.x = 0;
        joystickVector.y = 0;
    }
}, { passive: false });

function resetJoystick() {
    isTouching = false;
    joystickBase.classList.add('joystick-hidden');
    joystickVector = { x: 0, y: 0 };
}

joystickZone.addEventListener('touchend', resetJoystick);
joystickZone.addEventListener('touchcancel', resetJoystick);

// Animation state
const standFrame = '../assets/characters/Character%200.png';
const walkFrames = [
    '../assets/characters/Character%201.png',
    '../assets/characters/Character%202.png',
    '../assets/characters/Character%203.png'
];
let currentFrame = 0;
let animationTimer = 0;
const animationSpeed = 12; // Frames per toggle

// Check if the given coordinates represent a "green" part of the map
function isGreen(x, y) {
    if (!mapData) return true; // Allow movement before map loads just in case
    
    // Bounds check
    if (x < 0 || x >= mapBaseWidth || y < 0 || y >= mapBaseHeight) return false;

    // Check a small radius around the player's feet (hitbox)
    // Shifted down by 3 pixels to align visually better with the ground perspective
    const checkRadius = 1;
    for(let offsetY = 1; offsetY <= 3; offsetY++) { // Shifted Y bounds down
        for(let offsetX = -checkRadius; offsetX <= checkRadius; offsetX++) {
            const px = Math.floor(x + offsetX);
            const py = Math.floor(y + offsetY);
            
            if (px < 0 || px >= mapBaseWidth || py < 0 || py >= mapBaseHeight) return false;
            
            const idx = (py * mapBaseWidth + px) * 4;
            const r = mapData[idx];
            const g = mapData[idx + 1];
            const b = mapData[idx + 2];
            const a = mapData[idx + 3];

            // Ignore fully transparent pixels if they ever occur
            if (a < 10) continue; 
            
            // All "green parts" in the SVG have G significantly higher than B.
            // We allow R to be slightly higher than G to permit yellow decorative sunflowers,
            // while still blocking brown paths and dark borders.
            if (!(g > r - 30 && g > b + 10)) {
                return false; // Found an obstacle pixel in hitbox
            }
        }
    }

    return true;
}

// Check if player is near/touching the dark grey rock color (#2B2C2D)
function isTouchingRock(x, y) {
    if (!mapData) return false;
    
    // The rock detection area should be a large box around the player's center
    // We use a 25px radius to ensure it triggers flawlessly from any angle or edge
    const checkRadiusX = 25;
    const checkRadiusYTop = 25; 
    const checkRadiusYBottom = 25;
    
    for(let offsetY = -checkRadiusYTop; offsetY <= checkRadiusYBottom; offsetY++) {
        for(let offsetX = -checkRadiusX; offsetX <= checkRadiusX; offsetX++) {
            const px = Math.floor(x + offsetX);
            const py = Math.floor(y + offsetY);
            
            if (px < 0 || px >= mapBaseWidth || py < 0 || py >= mapBaseHeight) continue;
            
            const idx = (py * mapBaseWidth + px) * 4;
            const r = mapData[idx];
            const g = mapData[idx + 1];
            const b = mapData[idx + 2];
            const a = mapData[idx + 3];

            if (a < 10) continue;
            
            // Rock color is #2B2C2D which is roughly R:43, G:44, B:45
            // Allow a small margin of error due to anti-aliasing or slight variations
            if (Math.abs(r - 43) <= 4 && Math.abs(g - 44) <= 4 && Math.abs(b - 45) <= 4) {
                return true;
            }
        }
    }
    return false;
}

function update() {
    let dx = 0;
    let dy = 0;

    if (keys.w || keys.ArrowUp) dy -= playerSpeed;
    if (keys.s || keys.ArrowDown) dy += playerSpeed;
    if (keys.a || keys.ArrowLeft) dx -= playerSpeed;
    if (keys.d || keys.ArrowRight) dx += playerSpeed;

    // Add virtual joystick influence
    if (isTouching) {
        dx += joystickVector.x * playerSpeed;
        dy += joystickVector.y * playerSpeed;
    }

    // Normalize magnitude to prevent moving faster diagonally or with joystick
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length > playerSpeed) {
        dx = (dx / length) * playerSpeed;
        dy = (dy / length) * playerSpeed;
    }

    // Prevent movement if a modal is open
    if (identityOpen || paperOpen) {
        dx = 0;
        dy = 0;
    }

    const isMoving = dx !== 0 || dy !== 0;

    if (isMoving) {
        const nextX = playerX + dx;
        const nextY = playerY + dy;

        // Collision detection independently on X and Y axes (sliding effect)
        if (isGreen(nextX, playerY)) {
            playerX = nextX;
        }
        if (isGreen(playerX, nextY)) {
            playerY = nextY;
        }

        // Animation logic
        // Only play animation if modals are closed
        if (!identityOpen && !paperOpen) {
            animationTimer++;
            if (animationTimer >= animationSpeed) {
                animationTimer = 0;
                // Cycle 0 -> 1 -> 2 -> 0 ...
                currentFrame = (currentFrame + 1) % walkFrames.length;
                playerEl.src = walkFrames[currentFrame];
            }
        }
        
        // Direction facing
        if (dx < 0) {
            currentDirection = -1;
        } else if (dx > 0) {
            currentDirection = 1;
        }
    } else {
        // Standing stationary
        animationTimer = 0;
        currentFrame = 0;
        playerEl.src = standFrame;
    }

    // Update DOM position
    // Coordinates are percentages relative to base size
    playerEl.style.left = `${(playerX / mapBaseWidth) * 100}%`;
    playerEl.style.top = `${(playerY / mapBaseHeight) * 100}%`;
    playerEl.style.transform = `translate(-50%, -100%) scaleX(${currentDirection})`;

    // Check rock interaction and show/hide popup
    if (isTouchingRock(playerX, playerY)) {
        popupEl.classList.add('popup-visible');
    } else {
        popupEl.classList.remove('popup-visible');
    }

    requestAnimationFrame(update);
}

// Start game loop
requestAnimationFrame(update);
