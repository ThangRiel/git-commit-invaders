const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Cấu hình người chơi & game
let player = { x: 375, y: 530, width: 50, height: 30, speed: 7 };
let enemies = [];
let bullets = [];
let keys = {};
let score = 0;
let gameOver = false;

let lastShotTime = 0;
const shotCooldown = 300;
let animationFrameId = null;

// QUẢN LÝ QUÁI BAY CẢM TỬ
let divingEnemies = []; // Danh sách các con quái đang lao xuống
let lastDiveTime = 0;
const diveInterval = 1500; // Cứ mỗi 1.5 giây sẽ có quái lao xuống

let isDragging = false;

canvas.addEventListener("mousedown", () => {
    isDragging = true;
});

canvas.addEventListener("mouseup", () => {
    isDragging = false;
});

canvas.addEventListener("mouseleave", () => {
    isDragging = false;
});

canvas.addEventListener("mousemove", (e) => {
    if (!isDragging || gameOver) return;

    const rect = canvas.getBoundingClientRect();
    player.x = e.clientX - rect.left - player.width / 2;

    // Giới hạn trong canvas
    player.x = Math.max(
        0,
        Math.min(canvas.width - player.width, player.x)
    );
});

const gitColors = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];

function getWeekOfYear(dateString) {
    const date = new Date(dateString);
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const startDayOfWeek = startOfYear.getDay();
    const pastDaysOfYear = (date - startOfYear) / 86400000;
    return Math.floor((pastDaysOfYear + startDayOfWeek) / 7);
}

// 1. ĐỌC DỮ LIỆU VÀ KHỞI TẠO QUÁI
async function initGame() {
    try {
        const response = await fetch('contributions.json');
        const contributions = await response.json();

        enemies = contributions.map((item) => {
            const dateObj = new Date(item.date);
            let dayOfWeek = dateObj.getDay();
            const weekOfYear = getWeekOfYear(item.date);

            const size = 15;
            const spacing = 4;
            const startX = 40;
            const startY = 60;

            let count = item.count;
            let level = 1;
            if (count > 10) level = 4;
            else if (count > 5) level = 3;
            else if (count > 2) level = 2;

            return {
                // Tọa độ gốc trên Grid để quái biết đường bay về
                originX: startX + weekOfYear * (size + spacing),
                originY: startY + dayOfWeek * (size + spacing),
                x: startX + weekOfYear * (size + spacing),
                y: startY + dayOfWeek * (size + spacing),
                width: size,
                height: size,
                colorLevel: level,
                maxHp: count,
                date: item.date,

                // Trạng thái bay của từng con
                isDiving: false,
                targetX: 0,
                targetY: 0,
                diveState: "none", // none, down, up
                diveSpeed: 1
            };
        });

        score = 0;
        gameOver = false;
        bullets = [];
        divingEnemies = [];
        player.x = 375;
        lastDiveTime = Date.now();

        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        gameLoop();
    } catch (error) {
        console.error("Lỗi rồi mày ơi!", error);
    }
}

// 2. BẮT SỰ KIỆN BÀN PHÍM
window.addEventListener("keydown", (e) => {
    keys[e.key] = true;
    if (e.key === "Enter" && gameOver) initGame();
});
window.addEventListener("keyup", (e) => keys[e.key] = false);

// function handleInput() {
//     if (gameOver) return;

//     if (keys["ArrowLeft"] && player.x > 0) player.x -= player.speed;
//     if (keys["ArrowRight"] && player.x < canvas.width - player.width) player.x += player.speed;

//     if (keys[" "]) { 
//         let currentTime = Date.now();
//         if (currentTime - lastShotTime > shotCooldown) {
//             bullets.push({
//                 x: player.x + player.width / 2 - 2,
//                 y: player.y,
//                 width: 4,
//                 height: 12,
//                 speed: 9
//             });
//             lastShotTime = currentTime;
//         }
//     }
// }
function handleInput() {
    if (gameOver) return;

    if ((keys["ArrowLeft"] || keys["a"] || keys["A"]) && player.x > 0) {
        player.x -= player.speed;
    }

    if ((keys["ArrowRight"] || keys["d"] || keys["D"]) &&
        player.x < canvas.width - player.width) {
        player.x += player.speed;
    }

    let currentTime = Date.now();

    if (currentTime - lastShotTime > shotCooldown) {
        bullets.push({
            x: player.x + player.width / 2 - 2,
            y: player.y,
            width: 4,
            height: 12,
            speed: 9
        });

        lastShotTime = currentTime;
    }
}

// 3. CẬP NHẬT LOGIC GAME
function updateGame() {
    if (gameOver) return;

    // Di chuyển đạn
    bullets.forEach((bullet, bIndex) => {
        bullet.y -= bullet.speed;
        if (bullet.y < 0) bullets.splice(bIndex, 1);
    });

    let currentTime = Date.now();

    // TỰ ĐỘNG CHỌN QUÁI NGẪU NHIÊN ĐỂ LAO XUỐNG
    if (currentTime - lastDiveTime > diveInterval) {
        // Lọc ra những con quái còn sống và đang đứng yên trên Grid
        let aliveEnemies = enemies.filter(e => e.colorLevel > 0 && !e.isDiving);

        if (aliveEnemies.length > 0) {
            // Chọn ngẫu nhiên 1 hoặc 2 con
            let numDivers = Math.min(2, aliveEnemies.length);
            for (let i = 0; i < numDivers; i++) {
                let randomIndex = Math.floor(Math.random() * aliveEnemies.length);
                let luckyEnemy = aliveEnemies[randomIndex];

                // Cài đặt mục tiêu: Lao thẳng vào vị trí hiện tại của người chơi
                luckyEnemy.isDiving = true;
                luckyEnemy.diveState = "down";
                luckyEnemy.targetX = player.x + player.width / 2;
                luckyEnemy.targetY = player.y;

                // Tính toán hướng bay (Vector vận tốc)
                let dx = luckyEnemy.targetX - luckyEnemy.x;
                let dy = luckyEnemy.targetY - luckyEnemy.y;
                let distance = Math.sqrt(dx * dx + dy * dy);

                luckyEnemy.vx = (dx / distance) * luckyEnemy.diveSpeed;
                luckyEnemy.vy = (dy / distance) * luckyEnemy.diveSpeed;

                // Xóa khỏi mảng tạm để tránh chọn trùng con đó trong cùng 1 lượt
                aliveEnemies.splice(randomIndex, 1);
            }
        }
        lastDiveTime = currentTime;
    }

    // XỬ LÝ LOGIC DI CHUYỂN CỦA QUÁI ĐANG BAY
    enemies.forEach((enemy) => {
        if (enemy.colorLevel > 0 && enemy.isDiving) {
            if (enemy.diveState === "down") {
                // Lao xuống mục tiêu
                enemy.x += enemy.vx;
                enemy.y += enemy.vy;

                // KIỂM TRA VA CHẠM VỚI NGƯỜI CHƠI (THUA)
                if (enemy.x < player.x + player.width &&
                    enemy.x + enemy.width > player.x &&
                    enemy.y < player.y + player.height &&
                    enemy.y + enemy.height > player.y) {
                    gameOver = true;
                }

                // Khi chạm hoặc vượt quá độ sâu mục tiêu, bắt đầu quay về
                if (enemy.y >= enemy.targetY) {
                    enemy.diveState = "up";
                    // Tính lại vector hướng về vị trí cũ trên Grid
                    let dx = enemy.originX - enemy.x;
                    let dy = enemy.originY - enemy.y;
                    let distance = Math.sqrt(dx * dx + dy * dy);
                    enemy.vx = (dx / distance) * enemy.diveSpeed;
                    enemy.vy = (dy / distance) * enemy.diveSpeed;
                }
            } else if (enemy.diveState === "up") {
                // Bay ngược về Grid
                enemy.x += enemy.vx;
                enemy.y += enemy.vy;

                // Kiểm tra xem đã về gần vị trí cũ chưa (khoảng cách < 5px)
                let dx = enemy.originX - enemy.x;
                let dy = enemy.originY - enemy.y;
                if (Math.sqrt(dx * dx + dy * dy) < 5) {
                    enemy.x = enemy.originX;
                    enemy.y = enemy.originY;
                    enemy.isDiving = false;
                    enemy.diveState = "none";
                }
            }
        }
    });

    // Va chạm giữa Đạn và Quái
    bullets.forEach((bullet, bIndex) => {
        enemies.forEach((enemy) => {
            if (enemy.colorLevel > 0) {
                if (bullet.x < enemy.x + enemy.width &&
                    bullet.x + bullet.width > enemy.x &&
                    bullet.y < enemy.y + enemy.height &&
                    bullet.y + bullet.height > enemy.y) {

                    bullets.splice(bIndex, 1);
                    enemy.colorLevel -= 1;

                    if (enemy.colorLevel === 0) {
                        score += enemy.maxHp;
                        enemy.isDiving = false; // Nếu chết lúc đang bay thì hủy trạng thái bay
                    }
                }
            }
        });
    });
}

// 4. VẼ GIAO DIỆN
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!gameOver) {
        ctx.fillStyle = "#8b949e";
        ctx.font = "12px 'Courier New'";
        ctx.fillText("Mon", 10, 91);
        ctx.fillText("Wed", 10, 129);
        ctx.fillText("Fri", 10, 167);
    }

    // Vẽ tàu người chơi
    ctx.fillStyle = "#58a6ff";
    ctx.fillRect(player.x, player.y, player.width, player.height);

    // Vẽ đạn
    ctx.fillStyle = "#ff4500";
    bullets.forEach(bullet => ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height));

    // Vẽ lưới quái vật Commit
    enemies.forEach(enemy => {
        if (enemy.colorLevel > 0) {
            ctx.fillStyle = gitColors[enemy.colorLevel];
            ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
        }
    });

    // Bảng điểm
    ctx.fillStyle = "#ffffff";
    ctx.font = "20px 'Courier New'";
    ctx.fillText(`SCORE: ${score}`, 20, 35);

    // MÀN HÌNH GAME OVER
    if (gameOver) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "#ff7b72";
        ctx.font = "40px 'Courier New'";
        ctx.textAlign = "center";
        ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2 - 20);

        ctx.fillStyle = "#ffffff";
        ctx.font = "20px 'Courier New'";
        ctx.fillText(`Total Score: ${score}`, canvas.width / 2, canvas.height / 2 + 20);
        ctx.fillText("Press ENTER to Restart", canvas.width / 2, canvas.height / 2 + 60);
        ctx.textAlign = "left";
    }
}

function gameLoop() {
    handleInput();
    updateGame();
    draw();
    animationFrameId = requestAnimationFrame(gameLoop);
}

initGame();