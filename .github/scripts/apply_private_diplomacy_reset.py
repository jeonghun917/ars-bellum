from pathlib import Path

path = Path("index.html")
text = path.read_text(encoding="utf-8")

replacements = {
    '<button class="menu-btn btn-practice" onclick="resetDiplomacyForNewBattle(); startPracticeMode()">🎲 연습장</button>':
    '<button id="btn-practice-mode" class="menu-btn btn-practice">🎲 연습장</button>',
    '<button class="menu-btn btn-maingame" onclick="resetDiplomacyForNewBattle(); startMainGameMode()">🏰 본게임</button>':
    '<button id="btn-main-game-mode" class="menu-btn btn-maingame">🏰 본게임</button>',
    ' window.resetDiplomacyForNewBattle=function(){':
    ' const resetDiplomacyForNewBattle=()=>{',
}

for old, new in replacements.items():
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"exact replacement count failed: {old[:50]!r}, count={count}")
    text = text.replace(old, new, 1)

anchor = (
    '     diploChatBox.innerHTML=\'<div class="lord-msg">"감히 내 영지에 발을 들이다니, 목숨이 아깝지 않은 모양이군. 할 말이 있다면 들어나 보겠다."</div>\';\n'
    ' };\n'
    ' window.openDiplomacy=function()'
)
replacement = (
    '     diploChatBox.innerHTML=\'<div class="lord-msg">"감히 내 영지에 발을 들이다니, 목숨이 아깝지 않은 모양이군. 할 말이 있다면 들어나 보겠다."</div>\';\n'
    ' };\n'
    " const practiceModeButton=document.getElementById('btn-practice-mode');\n"
    " const mainGameModeButton=document.getElementById('btn-main-game-mode');\n"
    " if(practiceModeButton)practiceModeButton.addEventListener('click',()=>{resetDiplomacyForNewBattle();if(typeof window.startPracticeMode==='function')window.startPracticeMode();});\n"
    " if(mainGameModeButton)mainGameModeButton.addEventListener('click',()=>{resetDiplomacyForNewBattle();if(typeof window.startMainGameMode==='function')window.startMainGameMode();});\n"
    ' window.openDiplomacy=function()'
)

count = text.count(anchor)
if count != 1:
    raise SystemExit(f"listener insertion anchor count failed: {count}")
text = text.replace(anchor, replacement, 1)

if "window.resetDiplomacyForNewBattle" in text:
    raise SystemExit("public reset helper remains")
if text.count("const resetDiplomacyForNewBattle=()=>{") != 1:
    raise SystemExit("private reset helper count invalid")

path.write_text(text, encoding="utf-8")
