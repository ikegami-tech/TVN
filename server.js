const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto'); // 💡 追加: 100%被らないランダム文字列を作るため
const { Document, Packer, Paragraph, TextRun } = require('docx');

const SAVE_DIR = path.join(os.homedir(), 'Desktop', '議事録');

if (!fs.existsSync(SAVE_DIR)) {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
}

// 💡 追加: 人間が分かりやすい日時文字列を作る関数 (例: 20260330_170522)
function getFormattedDate() {
    const d = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const server = http.createServer((req, res) => {
    // スマホからのアクセスを許可する設定
    res.setHeader('Access-Control-Allow-Origin', '*');

    // --- 📝 議事録（テキスト）の受信とWord化 ---
    if (req.method === 'POST' && req.url === '/save') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        
        req.on('end', async () => {
            try {
                const paragraphs = body.split('\n').map(line => new Paragraph({ children: [new TextRun(line)] }));
                const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
                
                // 💡 修正: 日付 ＋ ランダムな英数字で、同時に来ても絶対に被らないファイル名にする
                const randomId = crypto.randomBytes(2).toString('hex'); // 例: "a1b2"
                const filename = `議事録_${getFormattedDate()}_${randomId}.docx`;
                const filepath = path.join(SAVE_DIR, filename);
                
                const buffer = await Packer.toBuffer(doc);
                fs.writeFileSync(filepath, buffer);
                
                console.log(`\n✅ 新しいWord議事録を受信しました！\n📁 場所: ${filepath}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error("保存エラー:", error);
                res.writeHead(500);
                res.end();
            }
        });
    } 
    // --- 🎵 音声データの受信と保存 ---
    else if (req.method === 'POST' && req.url === '/save-audio') {
        const extension = req.headers['x-extension'] || '.m4a';
        
        // 💡 修正: スマホから送られてくる「分割番号 (part1, part2...)」を受け取る
        const partNumber = req.headers['x-file-part']; 
        const partSuffix = partNumber ? `_part${partNumber}` : ''; 
        
        const randomId = crypto.randomBytes(2).toString('hex');
        // 例: 音声データ_20260330_170522_a1b2_part1.m4a
        const filename = `音声データ_${getFormattedDate()}_${randomId}${partSuffix}${extension}`;
        const filepath = path.join(SAVE_DIR, filename);
        
        // 音声データを少しずつ受信してファイルに書き込む
        const fileStream = fs.createWriteStream(filepath);
        req.pipe(fileStream);

        req.on('end', () => {
            console.log(`\n✅ 音声データ${partSuffix ? ` (${partSuffix})` : ''} を受信しました！\n📁 場所: ${filepath}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });

        req.on('error', (err) => {
            console.error("音声受信エラー:", err);
            res.writeHead(500);
            res.end();
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 PC側受信サーバーが起動しました（ポート: ${PORT}）`);
    console.log(`保存先: ${SAVE_DIR}`);
    console.log(`※この黒い画面を開いたままにしておくと受信できます。停止は Ctrl+C です。`);
});