// Compact GUI: the shared Basecoat shell with a short brand, no command palette and denser styling
// (compact.css). Only the sections listed in gui.json are loaded.
import { startShell } from '../../ui/basecoat/shell.js';

export default ({ gui, modules }) => startShell({ gui, modules, brand: 'TT<span>COMPACT</span>', palette: false, className: 'compact' });
