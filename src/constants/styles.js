import { C } from "./colors";

export const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Open+Sans:wght@400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Open Sans', sans-serif; background: ${C.gray50}; color: ${C.black}; }
  h1,h2,h3,h4,h5 { font-family: 'Montserrat', sans-serif; }
  button { cursor: pointer; border: none; outline: none; font-family: 'Open Sans', sans-serif; }
  input, select, textarea { font-family: 'Open Sans', sans-serif; outline: none; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: ${C.gray100}; }
  ::-webkit-scrollbar-thumb { background: ${C.gray400}; border-radius: 3px; }
  @keyframes slideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .card-hover:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(139,26,26,0.12); }
  .fade-in { animation: fadeIn 0.35s ease; }
`;
