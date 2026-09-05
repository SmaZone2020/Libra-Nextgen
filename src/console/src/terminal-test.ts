// Bare xterm test page — official-demo style.
// Loads ONLY xterm's own css: no Tailwind, no app.css, no global fonts.
// Open http://<dev-host>:5173/terminal-test.html to compare against the
// terminal inside the Libra shell on the same device/browser.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const container = document.getElementById('terminal');
if (!container) throw new Error('missing #terminal');

const term = new Terminal({
  cursorBlink: true,
  convertEol: true,
  fontSize: 14,
});
const fit = new FitAddon();
term.loadAddon(fit);
term.open(container);
fit.fit();

term.writeln('Libra-SMAZONE $ echo 1');
term.writeln('Libra-SMAZONE $ 1234567890 M i l');
term.write('Libra-SMAZONE $ ');

window.addEventListener('resize', () => {
  try {
    fit.fit();
  } catch {
    /* ignore */
  }
});
