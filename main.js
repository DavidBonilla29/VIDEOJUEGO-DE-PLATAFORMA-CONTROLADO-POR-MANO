import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

// ---------- Elementos DOM (Reducidos) ----------
const demosSection = document.getElementById("demos");
const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const ctx = canvasElement.getContext("2d");
const webcamButton = document.getElementById("webcamButton");

// ---------- HandLandmarker ----------
let handLandmarker = undefined;
let runningMode = "VIDEO"; // usamos VIDEO mode
let webcamRunning = false;
let modelLoaded = false;

// ---------- Juego (física) ----------
const GRAVITY = 1.1; 
const FRICTION = 0.9;        
const MOVE_LERP = 0.12;      
const JUMP_FORCE = -17;      
const JUMP_SENSITIVITY = 0.035; 
const JUMP_COOLDOWN_MS = 400;  

let lastIndexY = null;
let lastJumpTime = 0;

// Canvas / mundo
let worldWidth = 1280;  
let worldHeight = 720;

// NUEVO: Estado del juego para controlar lo que se dibuja
const GAME_STATE = {
    WAITING: 'WAITING', 
    INSTRUCTIONS: 'INSTRUCTIONS', 
    ACTIVE: 'ACTIVE', 
    PAUSED: 'PAUSED', 
    GAME_OVER_MENU: 'GAME_OVER_MENU' // Maneja Derrota y Victoria
};
let gameState = GAME_STATE.WAITING;


function resizeCanvasToVideo() {
    canvasElement.width = video.videoWidth || 1280;
    canvasElement.height = video.videoHeight || 720;
}

// Player
const player = {
    x: 120,
    y: 0,
    vx: 0,
    vy: 0,
    width: 48,
    height: 64,
    onGround: false,
    color: "#ff3b3b"
};

// Niveles
const levels = [
    {
        platforms: [
            { x: 0, y: 620, w: 1280, h: 100 }, 
            { x: 180, y: 520, w: 150, h: 20 }, 
            { x: 450, y: 420, w: 120, h: 20 }, 
            { x: 750, y: 320, w: 100, h: 20 } 
        ],
        spikes: [
            { x: 355, y: 580, w: 40, h: 40 }, 
            { x: 600, y: 580, w: 40, h: 40 },
            { x: 480, y: 380, w: 40, h: 40 }
        ],
        door: { x: 1000, y: 560, w: 60, h: 60 }, 
        bg: "#e8f7f6"
    },
    {
        platforms: [
            { x: 0, y: 620, w: 1280, h: 100 },
            { x: 140, y: 520, w: 120, h: 20 },
            { x: 380, y: 440, w: 100, h: 20 }, 
            { x: 650, y: 360, w: 150, h: 20 },
            { x: 950, y: 460, w: 80, h: 20 }  
        ],
        spikes: [
            { x: 850, y: 580, w: 40, h: 40 }, 
            { x: 100, y: 480, w: 40, h: 40 } 
        ],
        door: { x: 1120, y: 365, w: 60, h: 60 },
        bg: "#fff8e6"
    },
    {
        platforms: [
            { x: 0, y: 620, w: 1280, h: 100 },
            { x: 200, y: 540, w: 100, h: 20 },
            { x: 380, y: 450, w: 80, h: 20 }, 
            { x: 500, y: 360, w: 60, h: 20 }, 
            { x: 700, y: 280, w: 120, h: 20 }, 
            { x: 950, y: 200, w: 80, h: 20 }  
        ],
        spikes: [
            { x: 550, y: 580, w: 40, h: 40 }, 
            { x: 520, y: 320, w: 40, h: 40 } 
        ],
        door: { x: 1100, y: 120, w: 60, h: 60 }, 
        bg: "#e9f2ff"
    }
];

let currentLevelIndex = 0;
let score = 0;
let lives = 3;
let messageText = "";

// Inicialización HandLandmarker
const createHandLandmarker = async () => {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
        },
        runningMode: runningMode,
        numHands: 1
    });
    modelLoaded = true;
    demosSection.classList.remove("invisible");
    if (!webcamRunning) {
        webcamButton.querySelector('.mdc-button__label').innerText = "INICIAR JUEGO";
        gameState = GAME_STATE.WAITING; 
    }
    predictWebcam();
};
createHandLandmarker();

// Controles webcam
function hasGetUserMedia() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

if (hasGetUserMedia()) {
    webcamButton.addEventListener("click", toggleCam);
    canvasElement.addEventListener("click", handleCanvasClick); 
} else {
    console.warn("getUserMedia() no es compatible con tu navegador");
}

function toggleCam() {
    if (!handLandmarker) {
        console.warn("Espera a que cargue el modelo de HandLandmarker.");
        return;
    }
    if (webcamRunning) {
        stopCam();
    } else {
        startCam();
    }
}

function startCam() {
    const constraints = { video: { width: { ideal: 1280 }, height: { ideal: 720 } } };
    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        video.srcObject = stream;
        video.onloadeddata = () => {
            webcamRunning = true;
            webcamButton.querySelector('.mdc-button__label').innerText = "PARAR CÁMARA";
            resizeCanvasToVideo();
            gameState = GAME_STATE.INSTRUCTIONS; 
        };
    }).catch((e) => {
        console.error("No se pudo acceder a la webcam:", e);
    });
}

function stopCam() {
    webcamRunning = false;
    webcamButton.querySelector('.mdc-button__label').innerText = "INICIAR JUEGO";
    const tracks = video.srcObject?.getTracks?.();
    if (tracks) tracks.forEach(t => t.stop());
    video.srcObject = null;
    gameState = GAME_STATE.WAITING;
}

// Juego: niveles, reinicio
function startLevel(index) {
    currentLevelIndex = index;
    // Posición inicial del jugador
    player.x = 60;
    player.y = 520;
    player.vx = 0;
    player.vy = 0;
    player.onGround = false;
    if (index === 0) {
        score = 0;
        lives = 3;
    }
    gameState = GAME_STATE.ACTIVE;
}

function restartCurrentLevel() {
    lives--;
    
    if (lives > 0) {
        messageText = `¡OUCH! Perdiste una vida. Te quedan ${lives} vidas.`;
        // Reinicia la posición
        player.x = 60;
        player.y = 520;
        player.vx = 0;
        player.vy = 0;
        player.onGround = false;
        
        gameState = GAME_STATE.PAUSED;
        setTimeout(() => { 
            gameState = GAME_STATE.ACTIVE; 
        }, 2000); 
    } else {
         // GAME OVER (0 vidas)
        messageText = `GAME OVER! Puntuación final: ${score}.`;
        gameState = GAME_STATE.GAME_OVER_MENU; 
    }
}


function nextLevel() {
    currentLevelIndex++;
    if (currentLevelIndex >= levels.length) {
        // *** IMPLEMENTACIÓN DE VICTORIA ***
        messageText = `¡VICTORIA! Completaste los ${levels.length} niveles. Puntuación final: ${score}.`;
        gameState = GAME_STATE.GAME_OVER_MENU; // Muestra el menú de Victoria (permanente)
        return;
    }
    
    // Re-posiciona al jugador en el inicio del nuevo nivel
    player.x = 60;
    player.y = 520;
    player.vx = 0;
    player.vy = 0;
    player.onGround = false;

    messageText = `¡NIVEL ${currentLevelIndex + 1} DESBLOQUEADO!`;
    gameState = GAME_STATE.PAUSED;
    setTimeout(() => { 
        gameState = GAME_STATE.ACTIVE; 
    }, 1500); 
}

// Función para dibujar y manejar clics del menú
function handleCanvasClick(event) {
    const rect = canvasElement.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    
    const cw = canvasElement.width;
    const ch = canvasElement.height;
    const canvasClickX = (clickX / rect.width) * cw;
    const canvasClickY = (clickY / rect.height) * ch;

    const buttonW = 280; // Ajustado a 280px para el botón de REINICIO TOTAL
    const buttonH = 50;
    const buttonX = cw / 2 - buttonW / 2;
    
    // --- Lógica del menú de Instrucciones (Botón JUGAR) ---
    if (gameState === GAME_STATE.INSTRUCTIONS) {
        const instructButtonY = ch / 2 + 120;
        if (canvasClickX >= buttonX && canvasClickX <= buttonX + buttonW && 
            canvasClickY >= instructButtonY && canvasClickY <= instructButtonY + buttonH) {
            
            startLevel(0);
            return;
        }
    }
    
    // --- Lógica del menú de Game Over/Victoria ---
    if (gameState === GAME_STATE.GAME_OVER_MENU) {
        const isGameOverTotal = lives <= 0;
        const isVictory = currentLevelIndex >= levels.length; 
        
        // Botón 1: REINICIAR JUEGO TOTAL 
        let button1Y = ch / 2 + (isGameOverTotal || isVictory ? 50 : 70); 
        
        if (canvasClickX >= buttonX && canvasClickX <= buttonX + buttonW && 
            canvasClickY >= button1Y && canvasClickY <= button1Y + buttonH) {
            
            startLevel(0); // Reinicia el juego total
            return;
        }
        
        // Botón 2: REINICIAR NIVEL (Solo si NO es Game Over total y no ha ganado)
        if (!isGameOverTotal && !isVictory) {
            const button2Y = ch / 2 + 0; 
            
            if (canvasClickX >= buttonX && canvasClickX <= buttonX + buttonW && 
                canvasClickY >= button2Y && canvasClickY <= button2Y + buttonH) {
                
                startLevel(currentLevelIndex); // Reinicia la posición en el nivel actual
                return;
            }
        }
    }
}


// HUD (Dibujado en el canvas)
function drawHUD() {
    ctx.font = "24px Inter, sans-serif";
    ctx.fillStyle = "#333";
    ctx.textAlign = "start";
    
    const hMargin = 20;
    const vMargin = 20;
    
    ctx.fillText(`Nivel: ${currentLevelIndex + 1}/${levels.length}`, hMargin, vMargin + 25);
    ctx.fillText(`Puntos: ${score}`, hMargin + 200, vMargin + 25);
    ctx.fillText(`Vidas: ${lives}`, hMargin + 400, vMargin + 25);
}

function drawInitialInstructions() {
    // ... (El código de drawInitialInstructions permanece sin cambios)
    const cw = canvasElement.width;
    const ch = canvasElement.height;
    
    ctx.fillStyle = "#000000c0"; 
    ctx.fillRect(0, 0, cw, ch);
    
    ctx.font = "36px Inter, sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText("¡Bienvenido a PLATAFORMA!", cw / 2, ch / 2 - 120);
    
    ctx.font = "20px Inter, sans-serif";
    ctx.fillStyle = "#eee";
    ctx.fillText("Controles de Mano:", cw / 2, ch / 2 - 40);

    ctx.fillStyle = "#00ff99";
    ctx.font = "18px Inter, sans-serif";
    ctx.fillText("1. Movimiento Horizontal: Mueve la punta de tu dedo índice (posición X).", cw / 2, ch / 2 + 0);
    ctx.fillText("2. Salto: Mueve rápidamente tu mano hacia arriba (un 'pulso' en Y).", cw / 2, ch / 2 + 30);
    
    // Botón para iniciar el juego (Clicable)
    const buttonW = 280; // Usar el mismo ancho que el botón de reinicio
    const buttonH = 50;
    const buttonX = cw / 2 - buttonW / 2;
    const buttonY = ch / 2 + 120;
    
    ctx.fillStyle = "#ff3b3b";
    ctx.fillRect(buttonX, buttonY, buttonW, buttonH);
    ctx.strokeStyle = "#8b0000";
    ctx.strokeRect(buttonX, buttonY, buttonW, buttonH);
    
    ctx.font = "22px Inter, sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText("¡JUGAR!", cw / 2, buttonY + 32);
}


function drawGameMenu() {
    const cw = canvasElement.width;
    const ch = canvasElement.height;
    
    const isGameOverTotal = lives <= 0;
    const isVictory = currentLevelIndex >= levels.length; 
    
    // FONDO OSCURO COMPLETO (OCULTA CÁMARA)
    ctx.fillStyle = "#000000e0"; 
    ctx.fillRect(0, 0, cw, ch);
    
    // Título / Mensaje principal
    ctx.font = "48px Inter, sans-serif";
    // Color: Verde para Victoria, Rojo para Game Over Total
    ctx.fillStyle = isVictory ? "#00ff99" : (isGameOverTotal ? "#ff3b3b" : "#ffcc00"); 
    ctx.textAlign = "center";
    
    ctx.fillText(isVictory ? "¡VICTORIA TOTAL!" : (isGameOverTotal ? "GAME OVER" : "NIVEL FALLIDO"), cw / 2, ch / 2 - 70);
    
    ctx.font = "24px Inter, sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText(messageText, cw / 2, ch / 2 - 20); // Mensaje detallado (Puntuación, Vidas, etc.)
    
    const buttonW = 280; 
    const buttonH = 50; 
    const buttonX = cw / 2 - buttonW / 2;

    // --- Botón 1: REINICIAR JUEGO TOTAL (Siempre visible) ---
    const button1Y = ch / 2 + (isGameOverTotal || isVictory ? 50 : 70); 
    
    // Color: Verde para Victoria, Rojo para Game Over
    ctx.fillStyle = isVictory ? "#2ecc71" : "#e74c3c"; 
    ctx.fillRect(buttonX, button1Y, buttonW, buttonH);
    ctx.strokeStyle = isVictory ? "#116b2b" : "#8b0000";
    ctx.strokeRect(buttonX, button1Y, buttonW, buttonH);
    
    ctx.font = "22px Inter, sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText("REINICIAR JUEGO TOTAL", cw / 2, button1Y + 34);
    
    // --- Botón 2: REINICIAR NIVEL (Solo si NO es Game Over total y no ha ganado) ---
    if (!isGameOverTotal && !isVictory) {
        const button2Y = ch / 2 + 0;
        
        ctx.fillStyle = "#ffcc00"; 
        ctx.fillRect(buttonX, button2Y, buttonW, buttonH);
        ctx.strokeStyle = "#997300";
        ctx.strokeRect(buttonX, button2Y, buttonW, buttonH);
        
        ctx.font = "22px Inter, sans-serif";
        ctx.fillStyle = "#333";
        ctx.fillText("REINICIAR NIVEL", cw / 2, button2Y + 34);
    }
}


// Lógica física y dibujo
function worldToCanvasX(wx) {
    return (wx / worldWidth) * canvasElement.width;
}
function worldToCanvasY(wy) {
    return (wy / worldHeight) * canvasElement.height;
}

function drawSpike(spike) {
    // ... (sin cambios)
    const cx = worldToCanvasX(spike.x);
    const cy = worldToCanvasY(spike.y);
    const cw = (spike.w / worldWidth) * canvasElement.width;
    const ch = (spike.h / worldHeight) * canvasElement.height;

    ctx.fillStyle = "#ff0000"; 
    
    ctx.beginPath();
    ctx.moveTo(cx, cy + ch);         
    ctx.lineTo(cx + cw / 2, cy);     
    ctx.lineTo(cx + cw, cy + ch);    
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#8b0000";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;
}

function draw() {
    // Fondo
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    if (gameState !== GAME_STATE.WAITING) {
        // ... (El dibujo del nivel permanece sin cambios)
        const lvl = levels[currentLevelIndex >= levels.length ? levels.length - 1 : currentLevelIndex]; // Usa el último nivel si ya ganó
        ctx.fillStyle = lvl.bg || "#ffffff";
        ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);

        // Dibujar elementos del nivel
        for (const p of lvl.platforms) {
            ctx.fillStyle = "#6b8e23";
            ctx.fillRect(
                worldToCanvasX(p.x),
                worldToCanvasY(p.y),
                (p.w / worldWidth) * canvasElement.width,
                (p.h / worldHeight) * canvasElement.height
            );
        }
        const d = lvl.door;
        ctx.fillStyle = "#2ecc71";
        ctx.fillRect(
            worldToCanvasX(d.x),
            worldToCanvasY(d.y),
            (d.w / worldWidth) * canvasElement.width,
            (d.h / worldHeight) * canvasElement.height
        );
        ctx.strokeStyle = "#116b2b";
        ctx.strokeRect(
            worldToCanvasX(d.x),
            worldToCanvasY(d.y),
            (d.w / worldWidth) * canvasElement.width,
            (d.h / worldHeight) * canvasElement.height
        );
        for (const s of lvl.spikes) {
            drawSpike(s);
        }

        // Dibujar player (solo si el juego está activo o en pausa/derrota parcial)
        const isVictory = currentLevelIndex >= levels.length;
        if (gameState !== GAME_STATE.GAME_OVER_MENU || (lives > 0 && !isVictory)) {
            ctx.save();
            ctx.fillStyle = player.color;
            ctx.fillRect(
                worldToCanvasX(player.x),
                worldToCanvasY(player.y),
                (player.width / worldWidth) * canvasElement.width,
                (player.height / worldHeight) * canvasElement.height
            );
            // Dibujar ojos
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(
                worldToCanvasX(player.x + 8),
                worldToCanvasY(player.y + 12),
                (10 / worldWidth) * canvasElement.width,
                (8 / worldHeight) * canvasElement.height
            );
            ctx.restore();
        }
        
        // Dibuja el HUD 
        if (gameState !== GAME_STATE.INSTRUCTIONS) {
            drawHUD();
        }
    }
    
    // Mensaje de estado (Pausa, Subida de Nivel, OUCH!)
    if (gameState === GAME_STATE.PAUSED) {
        ctx.fillStyle = "#000000a0"; 
        ctx.fillRect(0, canvasElement.height / 2 - 40, canvasElement.width, 80);
        
        ctx.font = "24px Inter, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.fillText(messageText, canvasElement.width / 2, canvasElement.height / 2 + 10);
        ctx.textAlign = "start";
    }
    
    // Menú de Game Over / Victoria
    if (gameState === GAME_STATE.GAME_OVER_MENU) {
        drawGameMenu();
    }
    
    // Instrucciones iniciales
    if (gameState === GAME_STATE.INSTRUCTIONS) {
        drawInitialInstructions();
    }

    // Mensaje de Espera / Carga
    if (gameState === GAME_STATE.WAITING) {
        let msg = "Presiona INICIAR JUEGO para empezar.";
        if (!modelLoaded) {
            msg = "Cargando modelo de control por mano...";
        }
        ctx.font = "24px Inter, sans-serif";
        ctx.fillStyle = "#333";
        ctx.textAlign = "center";
        ctx.fillText(msg, canvasElement.width / 2, canvasElement.height / 2);
        ctx.textAlign = "start";
    }
}

// Colisiones AABB (sin cambios)
function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// actualiza física del jugador y colisiones (sin cambios)
function physicsStep() {
    // aplicar gravedad
    player.vy += GRAVITY;
    player.vx *= FRICTION;

    // límites laterales
    if (player.x < 0) player.x = 0;
    if (player.x + player.width > worldWidth) player.x = worldWidth - player.width;

    // aplicar velocidades
    player.x += player.vx;
    player.y += player.vy;

    player.onGround = false;

    const lvl = levels[currentLevelIndex];

    // 1. COMPROBAR COLISIÓN CON PICOS
    for (const s of lvl.spikes) {
        if (rectsOverlap(player.x, player.y, player.width, player.height, s.x, s.y, s.w, s.h)) {
            restartCurrentLevel();
            return; 
        }
    }

    // 2. COMPROBAR COLISIONES CON PLATAFORMAS 
    for (const p of lvl.platforms) {
        if (rectsOverlap(player.x, player.y, player.width, player.height, p.x, p.y, p.w, p.h)) {
            const prevY = player.y - player.vy;
            if (prevY + player.height <= p.y + 6) { 
                player.y = p.y - player.height;
                player.vy = 0;
                player.onGround = true;
            } else { 
                const prevX = player.x - player.vx;
                if (prevX + player.width <= p.x) { 
                     player.x = p.x - player.width - 1;
                } else if (prevX >= p.x + p.w) { 
                     player.x = p.x + p.w + 1;
                } else {
                     player.vy = 0;
                     player.y = p.y + p.h + 1;
                }
                player.vx = 0;
            }
        }
    }

    // 3. COMPROBAR PUERTA (META)
    const d = lvl.door;
    if (rectsOverlap(player.x, player.y, player.width, player.height, d.x, d.y, d.w, d.h)) {
        score += 100 * (currentLevelIndex + 1);
        nextLevel();
    }

    // 4. SI CAE FUERA DEL MUNDO (caída fatal)
    if (player.y > worldHeight + 200) {
        restartCurrentLevel();
    }
}

// Integración con HandLandmarker
async function predictWebcam() {
    
    if (!webcamRunning && gameState !== GAME_STATE.WAITING && gameState !== GAME_STATE.INSTRUCTIONS && gameState !== GAME_STATE.GAME_OVER_MENU) {
        draw();
        window.requestAnimationFrame(predictWebcam);
        return;
    }
    
    if (webcamRunning) {
        if (video.videoWidth && video.videoHeight) {
            canvasElement.width = video.videoWidth;
            canvasElement.height = video.videoHeight;
        }

        const startTimeMs = performance.now();
        const results = handLandmarker.detectForVideo(video, startTimeMs);

        // Solo procesar landmarks y física si el juego está ACTIVO
        if (gameState === GAME_STATE.ACTIVE) {
            if (results && results.landmarks && results.landmarks.length > 0) {
                const landmarks = results.landmarks[0];
                const indexTip = landmarks[8]; // {x, y, z} normalizados 0..1

                // MOVER HORIZONTAL
                const desiredWorldX = (1 - indexTip.x) * (worldWidth - player.width);
                player.x += (desiredWorldX - player.x) * MOVE_LERP;

                // Detectar "pulso" hacia arriba para salto
                if (lastIndexY !== null) {
                    const dy = lastIndexY - indexTip.y; 
                    const now = performance.now();
                    if (dy > JUMP_SENSITIVITY && player.onGround && (now - lastJumpTime) > JUMP_COOLDOWN_MS) {
                        player.vy = JUMP_FORCE;
                        player.onGround = false;
                        lastJumpTime = now;
                    }
                }
                lastIndexY = indexTip.y;

                // Dibujar landmark (para feedback visual)
                ctx.save();
                const px = indexTip.x * canvasElement.width;
                const py = indexTip.y * canvasElement.height;
                ctx.beginPath();
                ctx.fillStyle = "#004cff99";
                ctx.arc(px, py, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

            } else {
                lastIndexY = null;
            }

            // actualizar físicas
            physicsStep();
        } else {
            lastIndexY = null;
        }
    } else {
        lastIndexY = null;
    }


    // Siempre dibujar
    draw();

    // solicitar siguiente frame
    if (webcamRunning || gameState === GAME_STATE.WAITING || gameState === GAME_STATE.INSTRUCTIONS || gameState === GAME_STATE.GAME_OVER_MENU) {
        window.requestAnimationFrame(predictWebcam);
    }
}