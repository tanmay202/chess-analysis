const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 5001;

// Update this path to your stockfish.exe location
const STOCKFISH_PATH = path.join(__dirname, 'stockfish.exe');

app.use(cors());
app.use(express.json());

// Helper: run Stockfish for a single FEN and return { bestMove, centipawn }
function evaluateFen(fen, depth = 18) {
  return new Promise((resolve, reject) => {
    let engine;

    try {
      engine = spawn(STOCKFISH_PATH);
    } catch (err) {
      return reject(new Error('Could not start Stockfish. Check STOCKFISH_PATH.'));
    }

    let bestMove = null;
    let centipawn = 0;
    let responded = false;
    let buffer = '';

    const timeout = setTimeout(() => {
      if (!responded) {
        responded = true;
        try { engine.kill(); } catch (_) {}
        reject(new Error('Stockfish timed out'));
      }
    }, 30000);

    engine.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep the last incomplete line

      for (const line of lines) {
        const trimmed = line.trim();

        // Parse centipawn score
        if (trimmed.includes('score cp')) {
          const match = trimmed.match(/score cp (-?\d+)/);
          if (match) {
            centipawn = parseInt(match[1], 10);
          }
        }

        // Parse mate score — convert to a large centipawn value
        if (trimmed.includes('score mate')) {
          const match = trimmed.match(/score mate (-?\d+)/);
          if (match) {
            const mateIn = parseInt(match[1], 10);
            centipawn = mateIn > 0 ? 32000 - mateIn * 10 : -32000 - mateIn * 10;
          }
        }

        // bestmove signals the engine is done
        if (trimmed.startsWith('bestmove')) {
          const parts = trimmed.split(' ');
          bestMove = parts[1] || null;

          if (!responded) {
            responded = true;
            clearTimeout(timeout);
            try { engine.kill(); } catch (_) {}
            resolve({ bestMove, centipawn });
          }
        }
      }
    });

    engine.stderr.on('data', (data) => {
      console.error('[Stockfish stderr]', data.toString());
    });

    engine.on('error', (err) => {
      if (!responded) {
        responded = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    engine.on('close', () => {
      if (!responded) {
        responded = true;
        clearTimeout(timeout);
        resolve({ bestMove, centipawn });
      }
    });

    // Send UCI commands
    engine.stdin.write('uci\n');
    engine.stdin.write('setoption name Threads value 4\n');
    engine.stdin.write('setoption name Hash value 128\n');
    engine.stdin.write('isready\n');
    engine.stdin.write(`position fen ${fen}\n`);
    engine.stdin.write(`go depth ${depth}\n`);
  });
}

app.post('/evaluate-local', async (req, res) => {
  const { fen, depth = 18 } = req.body;

  if (!fen) {
    return res.status(400).json({ error: 'FEN string is required.' });
  }

  try {
    const result = await evaluateFen(fen, depth);
    // Return centipawn (not "evaluation") so the frontend matches
    res.json({
      bestMove: result.bestMove,
      centipawn: result.centipawn,
    });
  } catch (err) {
    console.error('[Evaluate error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', stockfish: STOCKFISH_PATH }));

app.listen(PORT, () => {
  console.log(`♟️  Stockfish server running → http://localhost:${PORT}`);
  console.log(`   Stockfish path: ${STOCKFISH_PATH}`);
});