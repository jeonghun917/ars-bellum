// The battle's styles. They are added inside the battle's own root element and removed with it,
// and every rule is scoped under .b2d-root so nothing leaks into the page around it.
export const BATTLE_CSS = `
.b2d-root { position: absolute; inset: 0; overflow: hidden; background: #1e272e; color: #fff; font-family: sans-serif; user-select: none; -webkit-user-select: none; }
.b2d-root * { box-sizing: border-box; }
.b2d-root .b2d-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
.b2d-root .b2d-layer { position: absolute; inset: 0; pointer-events: none; }
.b2d-root .b2d-layer > * { pointer-events: auto; }
.b2d-root button { cursor: pointer; border: none; border-radius: 4px; font-weight: bold; font-family: inherit; color: #fff; }
.b2d-root button:disabled { opacity: 0.5; cursor: default; }
.b2d-root [hidden] { display: none !important; }

.b2d-root .b2d-info { position: absolute; top: 12px; left: 12px; max-width: 38%; background: rgba(20, 25, 30, 0.9); border: 1px solid #f1c40f; border-radius: 8px; padding: 8px 10px; font-size: 13px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
.b2d-root .b2d-title { font-weight: bold; color: #f1c40f; }
.b2d-root .b2d-status { color: #b2bec3; font-size: 12px; margin-top: 2px; }
.b2d-root .b2d-roster { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.b2d-root .b2d-chip { background: rgba(255,255,255,0.1); border: 1px solid transparent; border-radius: 4px; padding: 3px 6px; font-size: 11px; }
.b2d-root .b2d-chip.is-selected { border-color: #f1c40f; background: rgba(241, 196, 15, 0.2); }
.b2d-root .b2d-chip.is-routing { color: #e67e22; }

.b2d-root .b2d-top-right { position: absolute; top: 12px; right: 12px; display: flex; gap: 5px; align-items: flex-start; }
.b2d-root .b2d-top-right button { background: rgba(30, 35, 40, 0.85); padding: 6px 10px; font-size: 13px; border: 1px solid rgba(255,255,255,0.2); }
.b2d-root .b2d-top-right button.is-active { background: #2980b9; }
.b2d-root .b2d-dropdown { position: relative; }
.b2d-root .b2d-dropdown-menu { position: absolute; right: 0; top: 100%; margin-top: 5px; min-width: 90px; background: rgba(30, 30, 30, 0.95); border-radius: 5px; overflow: hidden; box-shadow: 0 8px 16px rgba(0,0,0,0.5); z-index: 5; }
.b2d-root .b2d-dropdown-menu button { display: block; width: 100%; background: transparent; padding: 10px; border: none; border-bottom: 1px solid rgba(255,255,255,0.1); border-radius: 0; }

.b2d-root .b2d-prep { position: absolute; top: 120px; left: 50%; transform: translateX(-50%); text-align: center; z-index: 4; }
.b2d-root .b2d-prep-banner { background: rgba(192, 57, 43, 0.9); padding: 10px 20px; border-radius: 8px; font-weight: bold; font-size: 18px; margin-bottom: 10px; }
.b2d-root .b2d-prep-hint { font-size: 12px; color: #dfe6e9; margin-bottom: 10px; }
.b2d-root .b2d-start { padding: 14px 30px; font-size: 20px; background: #f1c40f; color: #111; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }

.b2d-root .b2d-bottom { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); width: 96%; max-width: 560px; display: flex; flex-direction: column; align-items: center; }
.b2d-root .b2d-sub-panel { margin-bottom: 6px; background: rgba(40, 45, 50, 0.95); padding: 6px; border-radius: 6px; border: 1px solid #555; gap: 4px; display: flex; overflow-x: auto; max-width: 100%; }
.b2d-root .b2d-bar { display: flex; width: 100%; background: rgba(20, 25, 30, 0.85); border-radius: 6px; padding: 6px 10px; border: 1px solid rgba(255,255,255,0.15); gap: 8px; align-items: center; overflow-x: auto; white-space: nowrap; }
.b2d-root .b2d-group { display: flex; gap: 4px; align-items: center; flex-shrink: 0; }
.b2d-root .b2d-label { color: #888; font-size: 11px; font-weight: bold; margin-right: 2px; }
.b2d-root .b2d-btn { padding: 8px 10px; font-size: 12px; background: #555; flex-shrink: 0; }
.b2d-root .b2d-btn:active { transform: scale(0.95); }
.b2d-root .b2d-btn.is-active { background: #2980b9; }
.b2d-root .b2d-btn.is-on { background: #e67e22; }
.b2d-root .b2d-btn-cmd { background: #d35400; } .b2d-root .b2d-btn-green { background: #27ae60; } .b2d-root .b2d-btn-danger { background: #c0392b; } .b2d-root .b2d-btn-attack { background: #8e44ad; } .b2d-root .b2d-btn-pick { background: #2980b9; }

.b2d-root .b2d-modal { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 90%; max-width: 400px; background: rgba(20, 25, 30, 0.95); border: 2px solid #c0392b; border-radius: 8px; z-index: 10; box-shadow: 0 10px 30px rgba(0,0,0,0.8); }
.b2d-root .b2d-modal-header { background: #c0392b; padding: 10px; font-weight: bold; font-size: 16px; border-radius: 6px 6px 0 0; display: flex; justify-content: space-between; align-items: center; }
.b2d-root .b2d-modal-header button { background: transparent; font-size: 16px; }
.b2d-root .b2d-modal-body { padding: 15px; color: #ddd; font-size: 14px; line-height: 1.5; }
.b2d-root .b2d-chat { min-height: 100px; max-height: 250px; overflow-y: auto; }
.b2d-root .b2d-lord { background: rgba(255,255,255,0.1); padding: 10px; border-left: 4px solid #f1c40f; margin-bottom: 10px; border-radius: 4px; }
.b2d-root .b2d-player { background: rgba(41, 128, 185, 0.3); padding: 10px; border-right: 4px solid #3498db; margin-bottom: 10px; border-radius: 4px; text-align: right; }
.b2d-root .b2d-notice { color: #f1c40f; font-size: 12px; text-align: center; margin-bottom: 10px; }
.b2d-root .b2d-chat-form { display: flex; padding: 10px; gap: 10px; border-top: 1px solid #444; }
.b2d-root .b2d-chat-input { flex: 1; padding: 8px; border-radius: 4px; border: none; background: #111; color: #fff; font-size: 14px; }
.b2d-root .b2d-send { padding: 8px 15px; background: #27ae60; }
.b2d-root .b2d-confirm-actions { display: flex; gap: 10px; justify-content: center; margin-top: 12px; }
.b2d-root .b2d-confirm-actions button { padding: 10px 24px; background: #555; }

.b2d-root .b2d-end { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.65); display: flex; align-items: center; justify-content: center; z-index: 20; }
.b2d-root .b2d-end-card { width: 90%; max-width: 420px; background: rgba(20, 25, 30, 0.97); border: 2px solid #f1c40f; border-radius: 10px; padding: 22px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.8); }
.b2d-root .b2d-end-title { font-size: 26px; font-weight: bold; color: #f1c40f; margin-bottom: 10px; }
.b2d-root .b2d-end-text { font-size: 14px; line-height: 1.7; color: #dfe6e9; white-space: pre-line; }
.b2d-root .b2d-end-continue { margin-top: 16px; padding: 12px 30px; font-size: 16px; background: #f1c40f; color: #111; }

@media (max-width: 700px) {
  .b2d-root .b2d-info { top: 54px; max-width: calc(100% - 24px); }
  .b2d-root .b2d-top-right { top: 8px; right: 8px; }
  .b2d-root .b2d-prep { top: 200px; width: 92%; }
  .b2d-root .b2d-prep-banner { font-size: 15px; padding: 8px 12px; }
}
`;
