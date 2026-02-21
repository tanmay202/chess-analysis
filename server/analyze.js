const express = require('express');
const { spawn } = require('child_process');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();
const PORT = 5001;

const STOCKFISH_PATH = 'C:\\Users\\tanma\\OneDrive\\Desktop\\PROJECTS\\chess-analysis\\server\\stockfish.exe';


app.use(cors());
app.use(bodyParser.json());

app.post('/evaluate-local', async (req, res) => {
  const { fen, depth } = req.body;
  if (!fen) return res.status(400).json({ error: 'Missing FEN' });

  const stockfish = spawn(STOCKFISH_PATH);

  let bestMove = null;
  let evaluation = null;

  stockfish.stdin.write(`position fen ${fen}\n`);
  stockfish.stdin.write(`go depth ${depth || 15}\n`);

  stockfish.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');

    for (const line of lines) {
      if (line.startsWith('bestmove')) {
        bestMove = line.split(' ')[1];
        stockfish.stdin.end();
      }

      if (line.includes('score')) {
        const match = line.match(/score (cp|mate) (-?\d+)/);
        if (match) {
          const type = match[1];
          const value = parseInt(match[2]);
          evaluation = type === 'cp' ? value : (value > 0 ? 32000 - value * 100 : -32000 - value * 100);
        }
      }
    }
  });

  stockfish.stderr.on('data', (data) => {
    console.error(`Stockfish error: ${data}`);
  });

  stockfish.on('close', () => {
    res.json({
      bestMove: bestMove || null,
      centipawn: evaluation !== null ? evaluation : null
    });
  });
});

app.listen(PORT, () => {
  console.log(`Local Stockfish evaluation server running at http://localhost:${PORT}`);
});
