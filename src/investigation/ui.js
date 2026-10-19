// 调查界面：全部为 HTML 叠加层（细线、编号、等宽数字，接近底特律的界面风格）
import { sound } from '../audio/sound.js';
import { createDialoguePlayer } from '../audio/dialoguePlayer.js';
import { VOICE_LINES } from '../audio/voiceEvents.js';
import { createVoiceMap } from '../audio/voiceMap.js';
import { isPlayer, onLang, tx } from '../i18n.js';
import { LINES } from './clues.js';

const voiceIdOf = createVoiceMap(LINES, VOICE_LINES);

const CSS = `
.inv { position: fixed; pointer-events: none; font-family: "PingFang SC", "Helvetica Neue", sans-serif; color: #dff2ff; user-select: none; }
.inv-mono { font-family: "SF Mono", Menlo, monospace; letter-spacing: 0.04em; }
#inv-fps { left: 16px; top: 12px; z-index: 8; font-size: 13px; letter-spacing: .08em; color: #9fd4ff; text-shadow: 0 1px 4px #000; }
#inv-hud { left: 32px; top: 25%; transform: translateY(-6px) scale(1.5); transform-origin: left bottom; opacity: 0; transition: opacity .4s; }
#inv-hud.on { opacity: 1; }
#inv-hud .mode { font-size: 13px; letter-spacing: .32em; color: #6cc8ff; display: flex; align-items: center; gap: 10px; }
#inv-hud .mode::before { content: ''; width: 8px; height: 8px; border: 1px solid currentColor; transform: rotate(45deg); flex: none; }
#inv-hud .count { margin-top: 8px; font-size: 22px; font-weight: 300; transition: opacity .32s ease, transform .32s ease; }
#inv-hud .count small { font-size: 12px; opacity: .6; margin-left: 8px; letter-spacing: .2em; }
#inv-hud .count b { font-weight: 500; color: #ffcf4a; }
#inv-hud .bar { margin-top: 8px; width: 220px; height: 2px; background: rgba(108,200,255,.2); transition: opacity .32s ease, transform .32s ease; }
#inv-hud .bar i { display: block; height: 100%; width: 0; background: #6cc8ff; transition: width .4s; }
#inv-hud .scan { display: none; margin-top: 12px; font-size: 13px; letter-spacing: .06em; color: rgba(223,242,255,.78); }
#inv-hud.search .scan { display: block; }
#inv-hud .scan b { display: inline-block; min-width: 18px; margin-right: 6px; padding: 0 5px; border: 1px solid rgba(223,242,255,.55); text-align: center; font-weight: 500; color: #ffcf4a; }
#inv-hud .mode .tag { display: none; }
#inv-hud.tagged .mode .lb { display: none; }
#inv-hud.tagged .mode .tag { display: inline; }
#inv-hud .count .txt { position: relative; display: inline-block; }
#inv-hud .count .body { display: inline-block; }
/* 完成：横线从左划过，文字转绿，进度条走满，菱形实心弹一下 */
#inv-hud .count .txt::after { content: ''; position: absolute; left: -4px; right: -4px; top: 54%; height: 2px; background: #b6f3c6; box-shadow: 0 0 8px rgba(182,243,198,.7); transform: scaleX(0); transform-origin: left; }
#inv-hud.complete .mode, #inv-hud.complete .count, #inv-hud.complete .count b { color: #b6f3c6; }
#inv-hud.complete .count { transition: color .3s, opacity .32s ease, transform .32s ease; }
#inv-hud.complete .count .txt::after { transform: scaleX(1); transition: transform .36s cubic-bezier(.6,0,.2,1) .1s; }
#inv-hud.complete .bar i { width: 100% !important; background: #b6f3c6; }
#inv-hud.complete .mode::before { background: currentColor; animation: inv-dia .5s ease-out; }
@keyframes inv-dia { from { transform: rotate(45deg) scale(2.2); opacity: .3; } to { transform: rotate(45deg) scale(1); opacity: 1; } }
/* 新目标：扫描线从左往右扫出文字（--k 为 0~1 的进度，由 updateHud 按游戏时间写入），标签闪两下 */
#inv-hud.enter .count .body { clip-path: inset(-8px calc((1 - var(--k, 1)) * 100%) -8px 0); }
#inv-hud.enter .count .txt::before { content: ''; position: absolute; top: -5px; bottom: -5px; left: calc(var(--k, 1) * 100%); width: 2px; background: #e8f6ff; box-shadow: 0 0 10px #6cc8ff, 0 0 2px #fff; opacity: calc(min(1, (1 - var(--k, 1)) * 6)); }
#inv-hud.enter .bar i { animation: inv-bar-in .55s ease both; }
#inv-hud.enter .mode .tag { animation: inv-tag .25s steps(2, jump-none) 2; }
@keyframes inv-bar-in { from { transform: scaleX(0); transform-origin: left; } to { transform: scaleX(1); transform-origin: left; } }
@keyframes inv-tag { from { opacity: .15; } to { opacity: 1; } }
#inv-hud.ready .mode, #inv-hud.ready .count { color: #ffcf4a; }
#inv-hud.ready .mode::before { border-color: #ffcf4a; }
#inv-hud.ready .bar i { background: #ffcf4a; }
#inv-hud.out .count, #inv-hud.out .bar { opacity: 0; transform: translateY(-12px); }
#inv-hud.in .count, #inv-hud.in .bar { animation: inv-task-in .42s ease; }
@keyframes inv-task-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
#inv-hint { left: 32px; bottom: 28px; font-size: 12px; opacity: .55; letter-spacing: .08em; line-height: 1.9; }
#inv-hint.recon { left: 50%; bottom: 36px; width: min(900px, 86vw); transform: translateX(-50%); text-align: center; }
#inv-hint b { display: inline-block; min-width: 18px; padding: 0 5px; margin-right: 6px; border: 1px solid rgba(223,242,255,.5); text-align: center; font-weight: 400; }
#inv-skip { right: 32px; bottom: 28px; padding: 9px 18px; overflow: hidden; font-size: 14px; letter-spacing: .12em; border: 1px solid rgba(223,242,255,.35); background: rgba(4,12,20,.55); opacity: 0; transition: opacity .25s, border-color .2s, color .2s; z-index: 7; }
#inv-skip.on { opacity: .9; }
#inv-skip .fill { position: absolute; inset: 0; background: rgba(255,207,74,.32); transform: scaleX(0); transform-origin: left; }
#inv-skip .txt { position: relative; }
#inv-skip b { display: inline-block; min-width: 18px; padding: 0 5px; margin: 0 6px; border: 1px solid rgba(223,242,255,.5); text-align: center; font-weight: 400; transition: border-color .2s; }
#inv-skip.holding { border-color: rgba(255,207,74,.8); color: #ffe7a3; }
#inv-skip.holding b { border-color: #ffcf4a; }
#inv-markers { inset: 0; }
.inv-mk { position: absolute; transform: translate(-50%, -50%) scale(1.5); transition: opacity .3s; }
.inv-mk .d { width: 22px; height: 22px; border: 2.5px solid #ffcf4a; transform: rotate(45deg); background: rgba(255,207,74,.16); box-shadow: 0 0 12px rgba(255,207,74,.55); }
.inv-mk .snap { position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; border: 2px solid #ffcf4a; transform: rotate(45deg) scale(1); opacity: 0; }
.inv-mk .snap.go { animation: inv-snap .55s ease-out; }
.inv-mk .n { position: absolute; left: 30px; top: -2px; font-size: 11px; color: #ffcf4a; white-space: nowrap; letter-spacing: .1em; }
.inv-mk.done .d { border-color: #e8f6ff; background: rgba(232,246,255,.15); box-shadow: none; }
.inv-mk.done .n { color: #e8f6ff; opacity: .7; }
.inv-mk.aim .d { width: 30px; height: 30px; margin: -4px; background: rgba(255,207,74,.3); }
.inv-mk.pop .d { animation: inv-pop .5s ease-out; }
@keyframes inv-pop { 0% { transform: rotate(45deg) scale(2.4); opacity: 0; } 100% { transform: rotate(45deg) scale(1); opacity: 1; } }
@keyframes inv-snap { 0% { transform: rotate(45deg) scale(3.4); opacity: .95; } 100% { transform: rotate(45deg) scale(1); opacity: 0; } }
#inv-prompt { left: 50%; bottom: 190px; transform: translateX(-50%); font-size: 14px; letter-spacing: .12em; padding: 8px 18px; border: 1px solid rgba(108,200,255,.5); background: rgba(4,12,20,.55); opacity: 0; transition: opacity .2s; white-space: nowrap; }
#inv-prompt.on { opacity: 1; }
#inv-prompt.gold { border-color: rgba(255,179,92,.7); color: #ffd9a8; }
#inv-read { left: 50%; bottom: 36px; transform: translateX(-50%); font-size: 13px; letter-spacing: .1em; white-space: nowrap; opacity: 0; transition: opacity .3s; }
#inv-read.on { opacity: .8; transition-delay: .45s; }
#inv-read b { display: inline-block; min-width: 18px; padding: 0 5px; margin: 0 6px 0 18px; border: 1px solid rgba(223,242,255,.5); text-align: center; font-weight: 400; }
#inv-analysis { inset: 0; opacity: 0; transition: opacity .18s; z-index: 2; }
#inv-analysis.on { opacity: 1; }
#inv-analysis .target { position: absolute; width: 176px; height: 140px; transform: translate(-50%, -50%); color: #ffe08a; filter: drop-shadow(0 0 6px rgba(255,207,74,.75)); transition: width .2s, height .2s; }
#inv-analysis.working .target, #inv-analysis.complete .target { width: 148px; height: 116px; }
#inv-analysis .corner { position: absolute; width: 26px; height: 26px; border: 0 solid currentColor; }
#inv-analysis .a { left: 0; top: 0; border-top-width: 4px; border-left-width: 4px; }
#inv-analysis .b { right: 0; top: 0; border-top-width: 4px; border-right-width: 4px; }
#inv-analysis .c { left: 0; bottom: 0; border-bottom-width: 4px; border-left-width: 4px; }
#inv-analysis .d { right: 0; bottom: 0; border-bottom-width: 4px; border-right-width: 4px; }
#inv-analysis .readout { position: absolute; width: 310px; color: #ffcf4a; transform: perspective(850px) rotateY(-9deg) rotateZ(2deg); transform-origin: left center; text-shadow: 0 1px 5px rgba(0,10,20,.9); }
#inv-analysis .readout::before { content: ''; position: absolute; left: -12px; top: -14px; bottom: -10px; width: 1px; background: linear-gradient(transparent, rgba(255,207,74,.45), transparent); }
#inv-analysis .heading { display: flex; align-items: center; gap: 18px; min-height: 54px; }
#inv-analysis .percent { font-size: 25px; font-weight: 300; font-variant-numeric: tabular-nums; }
#inv-analysis .status { margin-top: 2px; font-size: 16px; letter-spacing: .14em; }
#inv-analysis:not(.working):not(.complete) .status { font-size: 26px; font-weight: 500; letter-spacing: .12em; color: #ffe7a3; text-shadow: 0 0 14px rgba(255,207,74,.7); }
#inv-analysis .status b { display: inline-block; min-width: 32px; margin-right: 12px; padding: 2px 8px; border: 2px solid #ffcf4a; text-align: center; font-weight: 500; }
#inv-analysis .track { margin-top: 12px; height: 2px; background: rgba(255,207,74,.22); }
#inv-analysis .fill { display: block; width: 100%; height: 100%; background: #ffcf4a; transform: scaleX(0); transform-origin: left; }
#inv-analysis .caption { margin-top: 9px; color: rgba(255,214,120,.9); font-size: 11px; letter-spacing: .12em; }
#inv-analysis:not(.working):not(.complete) .percent, #inv-analysis:not(.working):not(.complete) .track { display: none; }
#inv-analysis.complete .target { color: #90dcff; }
#inv-analysis.complete .fill { background: #cff0ff; }
#inv-panel { left: 0; top: 0; width: min(560px, 44vw); display: flex; gap: 22px; align-items: flex-start; opacity: 0; transition: opacity .35s; border-left: 2px solid #6cc8ff; padding: 18px 22px; background: linear-gradient(90deg, rgba(6,18,30,.82), rgba(6,18,30,.35)); z-index: 3; }
#inv-panel.on { opacity: 1; }
#inv-panel .txt { flex: 1; min-width: 0; }
#inv-panel .pic { position: relative; width: 250px; height: 250px; flex: none; margin-top: 4px; }
#inv-panel .pic .img { position: absolute; inset: 0; background-size: cover; background-position: center; clip-path: inset(0 0 100% 0); animation: inv-wipe .9s .25s cubic-bezier(.2,.7,.2,1) forwards; filter: saturate(.85) contrast(1.05); }
#inv-panel .pic .img::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(0,0,0,.18) 0 1px, transparent 1px 3px); }
#inv-panel .pic .scan { position: absolute; left: 0; right: 0; height: 2px; top: 0; background: #6cc8ff; box-shadow: 0 0 12px #6cc8ff; opacity: 0; animation: inv-scanline .9s .25s cubic-bezier(.2,.7,.2,1) forwards; }
#inv-panel .pic .cn { position: absolute; width: 14px; height: 14px; border: 0 solid #6cc8ff; }
#inv-panel .pic .cn.a { left: -6px; top: -6px; border-left-width: 2px; border-top-width: 2px; }
#inv-panel .pic .cn.b { right: -6px; top: -6px; border-right-width: 2px; border-top-width: 2px; }
#inv-panel .pic .cn.c { left: -6px; bottom: -6px; border-left-width: 2px; border-bottom-width: 2px; }
#inv-panel .pic .cn.d { right: -6px; bottom: -6px; border-right-width: 2px; border-bottom-width: 2px; }
#inv-panel .pic .cap { position: absolute; left: 0; bottom: -22px; font-size: 10px; letter-spacing: .2em; color: #6cc8ff; opacity: .8; }
#inv-panel .pic .box { position: absolute; left: 30%; top: 32%; width: 40%; height: 36%; border: 1px solid rgba(255,207,74,.9); opacity: 0; animation: inv-in .3s 1.2s forwards; }
@keyframes inv-wipe { to { clip-path: inset(0 0 0 0); } }
@keyframes inv-scanline { 0% { top: 0; opacity: 1; } 90% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
#inv-panel .tag { font-size: 11px; letter-spacing: .3em; color: #6cc8ff; }
#inv-panel h2 { margin: 6px 0 14px; font-size: 22px; font-weight: 500; letter-spacing: .08em; }
#inv-panel .ln { font-size: 14px; line-height: 1.75; opacity: 0; transform: translateX(-6px); animation: inv-in .35s forwards; }
#inv-panel .ln::before { content: '— '; color: #6cc8ff; }
#inv-panel .res { margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(108,200,255,.3); font-size: 15px; color: #ffd27a; opacity: 0; animation: inv-in .35s forwards; }
#inv-panel .prob { display: flex; align-items: center; gap: 10px; margin-top: 8px; font-size: 12px; opacity: 0; animation: inv-in .35s forwards; }
#inv-panel .prob .pb { flex: 1; height: 3px; background: rgba(255,210,122,.2); }
#inv-panel .prob .pb i { display: block; height: 100%; background: #ffd27a; width: 0; transition: width 1s ease-out; }
@keyframes inv-in { to { opacity: 1; transform: none; } }
#inv-toast { left: 50%; top: 12%; transform: translateX(-50%); text-align: center; opacity: 0; transition: opacity .4s; }
#inv-toast.on { opacity: 1; }
#inv-toast .t1 { font-size: 11px; letter-spacing: .4em; color: #6cc8ff; }
#inv-toast .t2 { margin-top: 8px; font-size: 18px; letter-spacing: .06em; }
#inv-toast.big { padding: 12px 22px; background: rgba(5,12,20,.62); border: 1px solid rgba(255,207,74,.7); }
#inv-toast.big .t1 { font-size: 12px; letter-spacing: .36em; }
#inv-toast.big .t2 { margin-top: 8px; font-size: 22px; letter-spacing: .08em; color: #ffcf4a; }
#inv-tl { left: 50%; bottom: 84px; width: min(900px, 70vw); transform: translateX(-50%); opacity: 0; transition: opacity .4s; }
#inv-tl.on { opacity: 1; }
#inv-tl .head { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; letter-spacing: .25em; color: #6cc8ff; margin-bottom: 14px; }
#inv-tl .head .count { font-size: 13px; letter-spacing: .14em; color: #9fd4ff; }
#inv-tl .track { position: relative; display: flex; align-items: center; gap: 3px; height: 14px; }
#inv-tl .track > i { position: relative; z-index: 1; flex: 1; height: 14px; background: rgba(176,186,198,.32); }
#inv-tl .track > i.past { background: rgba(236,242,248,.92); }
#inv-tl .track > i.now { z-index: 3; background: #3aa7ff; box-shadow: 0 0 8px rgba(58,167,255,.85); }
#inv-tl .clock { position: absolute; top: 20px; transform: translateX(-50%); font-size: 12px; letter-spacing: .08em; color: #7ec8ff; white-space: nowrap; }
#inv-tl .ev { position: absolute; z-index: 2; top: 0; height: 14px; background: rgba(255,207,74,.72); }
#inv-tl .ev.rec { background: #ffcf4a; }
#inv-tl .ev.near { box-shadow: 0 0 8px #ffcf4a; }
#inv-sub { left: 50%; bottom: 128px; transform: translateX(-50%); max-width: 64vw; text-align: center; font-size: 28px; line-height: 1.6; letter-spacing: .06em; color: #f2f6fa; text-shadow: 0 2px 6px rgba(0,0,0,.95), 0 0 18px rgba(0,0,0,.7); opacity: 0; transition: opacity .25s; z-index: 6; }
#inv-sub.on { opacity: 1; }
#inv-sub.lift { bottom: calc(11vh + 36px); }
#inv-sub .who { color: #6cc8ff; margin-right: 12px; font-size: 22px; letter-spacing: .2em; }
#inv-sub.radio .who::before { content: '◉ '; color: #ff8a1a; }
#inv-sub.inner { font-style: italic; color: #e6e0d4; }
#inv-dream { left: 50%; top: 50%; width: 200px; height: 200px; transform: translate(-50%, -50%); opacity: 0; transition: opacity .15s; z-index: 4; }
#inv-dream.on { opacity: 1; }
#inv-dream svg { width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 0 6px rgba(255,207,74,.6)); }
#inv-dream circle, #inv-dream path { fill: none; }
#inv-dream .bg { stroke: rgba(255,207,74,.22); stroke-width: 3; }
#inv-dream .fg { stroke: #ffcf4a; stroke-width: 4; stroke-linecap: butt; }
#inv-dream .ticks { stroke: rgba(255,207,74,.45); stroke-width: 1; stroke-dasharray: 2 6.42; transform-origin: 100px 100px; }
#inv-dream .mark { stroke: #ffcf4a; stroke-width: 2; transform-origin: 100px 100px; }
#inv-dream .mark .pupil { fill: #ffcf4a; stroke: none; }
#inv-dream .mark .lid { stroke-width: 2.5; }
#inv-dream .mark .ray { stroke-width: 1.5; opacity: .7; }
#inv-dream .lb { position: absolute; left: 50%; top: calc(100% + 14px); transform: translateX(-50%); white-space: nowrap; font-size: 14px; letter-spacing: .32em; color: #ffcf4a; text-shadow: 0 1px 5px rgba(0,10,20,.9); }
#inv-rite { left: 50%; top: 22%; transform: translateX(-50%); text-align: center; opacity: 0; z-index: 5; text-shadow: 0 0 18px rgba(63,184,255,.55), 0 2px 6px rgba(0,0,0,.9); }
#inv-rite .t1 { font-size: 40px; font-weight: 300; letter-spacing: .3em; color: #cfeeff; white-space: nowrap; }
#inv-rite .t2 { margin-top: 10px; font-size: 18px; letter-spacing: .5em; color: #6cc8ff; }
#inv-rite .t3 { margin-top: 14px; font-size: 12px; letter-spacing: .3em; color: rgba(159,212,255,.75); }
#inv-tip { right: 48px; top: 50%; width: 340px; padding: 20px 24px 18px; transform: translate(16px, -50%); border-left: 2px solid #ffcf4a; background: linear-gradient(90deg, rgba(6,18,30,.86), rgba(6,18,30,.5)); opacity: 0; transition: opacity .35s, transform .35s; z-index: 4; }
#inv-tip.on { opacity: 1; transform: translate(0, -50%); }
#inv-tip .tag { font-size: 11px; letter-spacing: .3em; color: #ffcf4a; }
#inv-tip h3 { margin: 6px 0 14px; font-size: 20px; font-weight: 500; letter-spacing: .1em; }
#inv-tip .row { display: flex; align-items: center; gap: 12px; margin-top: 10px; font-size: 15px; line-height: 1.5; letter-spacing: .04em; }
#inv-tip .row b { flex: none; min-width: 52px; padding: 2px 6px; border: 1px solid rgba(223,242,255,.55); text-align: center; font-weight: 500; font-size: 13px; color: #ffcf4a; }
#inv-tip .row i { flex: none; width: 52px; height: 10px; background: rgba(255,207,74,.72); }
#inv-guide { left: 50%; bottom: 170px; transform: translate(-50%, 10px); display: flex; align-items: center; gap: 18px; padding: 14px 28px 14px 22px; border: 2px solid #ffcf4a; background: rgba(5,12,20,.8); box-shadow: 0 0 24px rgba(255,207,74,.35); font-size: 24px; letter-spacing: .1em; color: #ffe7a3; white-space: nowrap; opacity: 0; transition: opacity .3s, transform .3s; z-index: 6; }
#inv-guide.on { opacity: 1; transform: translate(-50%, 0); animation: inv-guide-pulse 1.4s ease-in-out infinite; }
#inv-guide b { font-weight: 500; color: #ffcf4a; }
#inv-guide svg { flex: none; width: 30px; height: 46px; }
#inv-guide .mouse { fill: none; stroke: #ffcf4a; stroke-width: 2.5; }
#inv-guide .wheel { fill: #ffcf4a; animation: inv-wheel 1s ease-in-out infinite; }
@keyframes inv-guide-pulse { 50% { box-shadow: 0 0 44px rgba(255,207,74,.75); border-color: #fff1c2; } }
@keyframes inv-wheel { 0% { transform: translateY(5px); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateY(-6px); opacity: 0; } }
#inv-tl .ev.goal { background: #ffcf4a; animation: inv-goal .9s ease-in-out infinite; }
#inv-tl .ev.goal::after { content: '▼'; position: absolute; left: 50%; top: -30px; transform: translateX(-50%); font-size: 20px; color: #ffcf4a; text-shadow: 0 0 10px rgba(255,207,74,.9); animation: inv-goal-arrow .9s ease-in-out infinite; }
@keyframes inv-goal { 50% { box-shadow: 0 0 16px 3px rgba(255,207,74,.9); } }
@keyframes inv-goal-arrow { 50% { top: -22px; } }
#inv-cine { inset: 0; z-index: 8; }
#inv-cine::before, #inv-cine::after { content: ''; position: absolute; left: 0; right: 0; height: 0; background: #000; transition: height .35s ease; }
#inv-cine::before { top: 0; }
#inv-cine::after { bottom: 0; }
#inv-cine.on::before, #inv-cine.on::after { height: 11vh; }
#inv-black { inset: 0; background: #000; opacity: 0; z-index: 9; }
#inv-fin { inset: 0; z-index: 10; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; opacity: 0; transition: opacity 2s ease; }
#inv-fin.on { opacity: 1; }
#inv-fin .t1 { font-size: 46px; font-weight: 300; letter-spacing: .6em; text-indent: .6em; color: #d8e2ea; }
#inv-fin .t2 { font-size: 22px; font-weight: 300; letter-spacing: .6em; text-indent: .6em; color: #ffcf4a; opacity: 0; transition: opacity 1.6s ease 1.4s; }
#inv-fin.on .t2 { opacity: 1; }
#inv-ending { inset: 0; z-index: 10; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; opacity: 0; transition: opacity 1.2s; }
#inv-ending.on { opacity: 1; }
#inv-ending h1 { margin: 0 0 22px; font-size: 30px; font-weight: 400; letter-spacing: .18em; color: #d8e2ea; }
#inv-ending h1 span { color: #ffcf4a; margin-right: .35em; }
#inv-ending .ln { font-size: 19px; letter-spacing: .12em; color: #d8e2ea; opacity: 0; animation: inv-in .8s forwards; }
#inv-ending .back { margin-top: 96px; font-size: 18px; letter-spacing: .22em; color: #ffcf4a; opacity: 0; animation: inv-in .8s forwards; }
`;

// 证据图（Gemini 生成），启动时预加载，避免面板弹出时图片还没到
const clueImage = (c) => `${import.meta.env.BASE_URL}assets/gen/clue_${c.id}.jpg`;
export function preloadClueImages(clues) {
  clues.forEach((c) => { const i = new Image(); i.src = clueImage(c); });
}

function el(id, cls = '', html = '') {
  const d = document.createElement('div');
  d.id = id;
  d.className = `inv ${cls}`;
  d.innerHTML = html;
  document.body.appendChild(d);
  return d;
}

export function createUI() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const fpsEl = el('inv-fps', 'inv-mono', '— FPS');
  let fpsSmooth = 0;
  let fpsShown = '';
  const hud = el('inv-hud', '', `<div class="mode"><span class="lb">分析模式</span><span class="tag"></span></div><div class="count inv-mono"><span class="txt"><span class="body"></span></span></div><div class="bar"><i></i></div><div class="scan"></div>`);
  const hint = el('inv-hint');
  const skip = el('inv-skip', '', '<i class="fill"></i><span class="txt"></span>');
  const skipFill = skip.querySelector('.fill');
  const markers = el('inv-markers');
  const prompt = el('inv-prompt');
  const readHint = el('inv-read');   // 看杂志时底部的操作提示
  const analysis = el('inv-analysis', '', `<div class="target"><i class="corner a"></i><i class="corner b"></i><i class="corner c"></i><i class="corner d"></i></div>
    <div class="readout"><div class="heading"><div><div class="percent inv-mono"></div><div class="status"></div></div></div>
    <div class="track" role="progressbar" aria-label="${tx('线索分析', 'Clue analysis')}" aria-valuemin="0" aria-valuemax="100"><i class="fill"></i></div><div class="caption"></div></div>`);
  const analysisTarget = analysis.querySelector('.target');
  const readout = analysis.querySelector('.readout');
  const analysisPercent = analysis.querySelector('.percent');
  const analysisStatus = analysis.querySelector('.status');
  const analysisFill = analysis.querySelector('.fill');
  const analysisTrack = analysis.querySelector('.track');
  const analysisCaption = analysis.querySelector('.caption');
  const panel = el('inv-panel');
  const toast = el('inv-toast', '', '<div class="t1"></div><div class="t2"></div>');
  const tl = el('inv-tl');
  const sub = el('inv-sub');
  // 按住 R 的进度环：外圈读条 + 刻度圈 + 中心的黑梦标志（一只睁开的眼，菱形瞳孔与线索菱形呼应）
  const DREAM_C = 2 * Math.PI * 88;
  const dream = el('inv-dream', '', `<svg viewBox="0 0 200 200">
    <circle class="bg" cx="100" cy="100" r="88"/>
    <circle class="fg" cx="100" cy="100" r="88" transform="rotate(-90 100 100)" stroke-dasharray="${DREAM_C}" stroke-dashoffset="${DREAM_C}"/>
    <circle class="ticks" cx="100" cy="100" r="74"/>
    <g class="mark">
      <path class="ray" d="M100 34 V50 M100 150 V166 M28 100 H42 M158 100 H172"/>
      <g class="eye"><path class="lid" d="M50 100 Q100 62 150 100 Q100 138 50 100 Z"/></g>
      <circle cx="100" cy="100" r="20" opacity=".55"/>
      <path class="pupil" d="M100 87 L113 100 L100 113 L87 100 Z"/>
    </g></svg><div class="lb">构建黑梦</div>`);
  const dreamFg = dream.querySelector('.fg');
  const dreamTicks = dream.querySelector('.ticks');
  const dreamEye = dream.querySelector('.eye');
  const dreamPupil = dream.querySelector('.pupil');
  for (const e of [dreamEye, dreamPupil]) e.style.transformOrigin = '100px 100px';
  const rite = el('inv-rite', '', '<div class="t1 inv-mono">BLACKDREAM</div><div class="t2"></div><div class="t3 inv-mono"></div>');
  const riteT1 = rite.querySelector('.t1');
  // 第一次黑梦：引导玩家滚滚轮倒回异常时刻的大号提示（带滚轮动画）
  const guide = el('inv-guide', '', `<svg viewBox="0 0 30 46"><rect class="mouse" x="2" y="2" width="26" height="42" rx="13"/><rect class="wheel" x="13" y="11" width="4" height="9" rx="2"/></svg><span></span>`);
  const guideText = guide.querySelector('span');
  // 第一次黑梦倒回异常时刻后弹出的操作说明
  const tip = el('inv-tip', '', `<div class="tag inv-mono"></div><h3></h3>
    <div class="row"><b></b><span></span></div>
    <div class="row"><b></b><span></span></div>
    <div class="row"><i></i><span></span></div>
    <div class="row"><b>E</b><span></span></div>
    <div class="row"><b>R</b><span></span></div>`);
  const cine = el('inv-cine');
  const black = el('inv-black');
  const fin = el('inv-fin', '', '<div class="t1"></div><div class="t2"></div>');
  const ending = el('inv-ending');
  let panelTimer = 0, toastTimer = 0, toastHold = null;
  const dialogue = createDialoguePlayer({
    show(l, radio) {
      const lift = cine.classList.contains('on') ? ' lift' : '';
      sub.className = `inv on${l.who ? (radio && !isPlayer(l.who) ? ' radio' : '') : ' inner'}${lift}`;
      sub.innerHTML = l.who ? `<span class="who">${l.who}</span>${l.text}` : l.text;
    },
    hide: () => sub.classList.remove('on'),
    playVoice: (l) => {
      const id = voiceIdOf(l);
      return id ? sound.voice(id) : null;
    },
    radioOn: () => sound.play('ui/radio_on'),
    radioOff: () => sound.play('ui/radio_off'),
  });

  const hints = () => ({
    explore: tx('<b>WASD</b>移动　<b>Shift</b>跑　<b>Q</b>扫描线索　<b>E</b>按住分析　<b>TAB</b>平板', '<b>WASD</b> move　<b>Shift</b> run　<b>Q</b> scan　<b>E</b> hold to analyze　<b>TAB</b> tablet'),
    recon: tx('<b>滚轮</b>拖动时间　<b>空格</b>播放 / 暂停　<b>E</b>按住分析　<b>R</b>退出黑梦', '<b>Wheel</b> scrub　<b>Space</b> play / pause　<b>E</b> hold to analyze　<b>R</b> leave'),
  });
  function paintStatic() {
    hud.querySelector('.scan').innerHTML = tx('按 <b>Q</b> 可以进行扫描', 'Press <b>Q</b> to scan');
    dream.querySelector('.lb').textContent = tx('构建黑梦', 'BUILD DREAM');
    skip.querySelector('.txt').innerHTML = tx('按住<b>TAB</b>跳过', 'Hold <b>TAB</b> to skip');
    rite.querySelector('.t2').textContent = tx('黑梦 · 现场重建', 'BLACK DREAM · REBUILD');
    fin.querySelector('.t1').textContent = tx('序章', 'PROLOGUE');
    fin.querySelector('.t2').textContent = tx('完', 'END');
    const rows = tip.querySelectorAll('.row span');
    tip.querySelector('.tag').textContent = tx('BLACKDREAM · 操作', 'BLACKDREAM · CONTROLS');
    tip.querySelector('h3').textContent = tx('在回放里找出异常', 'Find what does not fit');
    tip.querySelectorAll('.row b')[0].textContent = tx('滚轮', 'Wheel');
    tip.querySelectorAll('.row b')[1].textContent = tx('空格', 'Space');
    rows[0].textContent = tx('拖动回放时间', 'Scrub the replay');
    rows[1].textContent = tx('播放 / 暂停', 'Play / pause');
    rows[2].textContent = tx('黄色时段：可以分析的异常时刻', 'Yellow span: a moment you can analyze');
    rows[3].textContent = tx('按住分析', 'Hold to analyze');
    rows[4].textContent = tx('退出黑梦', 'Leave the dream');
    if (thisMode) hint.innerHTML = hints()[thisMode] ?? '';
    readHint.innerHTML = tx('<b>A</b><b>D</b>翻页　<b>E</b>放下', '<b>A</b><b>D</b> turn page　<b>E</b> put down');
  }
  let thisMode = '';
  paintStatic();
  onLang(() => paintStatic());

  const markerEls = new Map();
  const markPos = new Map();
  let clueId = null;

  // 分析面板挂在探索点所在的世界位置右侧。离开画面或走到点后面就看不见，不拉回屏幕内
  function placePanel(x, y, front) {
    const gap = 200;
    const pw = panel.offsetWidth || 560;
    const ph = panel.offsetHeight || 280;
    const left = x + gap;
    const top = y - ph * 0.4;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    const onScreen = front && left + pw > 0 && left < innerWidth && top + ph > 0 && top < innerHeight;
    panel.style.visibility = onScreen ? '' : 'hidden';
  }

  // ---------- 左侧任务的切换表现 ----------
  // 阶段按游戏时间推进（暂停时停住）：done 完成 0.85s → out 退出 0.3s → in 新目标扫出 0.6s，标签再停 1.4s
  // 任务栏看不见时（平板举起、过场）先挂起，看得见了只播「新目标」，玩家没看到的完成不补播
  const hudBody = hud.querySelector('.count .body');
  const hudBar = hud.querySelector('.bar i');
  const hudTag = hud.querySelector('.mode .tag');
  const TASK_DONE = 0.85, TASK_OUT = 0.3, TASK_SCAN = 0.5, TASK_IN = 0.6, TASK_TAG = 1.4;
  const task = { cur: null, next: null, phase: null, t: 0, tagT: 0 };
  const hudVisible = () => hud.classList.contains('on') && hud.style.visibility !== 'hidden';
  function paintTask(t) {
    hudBody.innerHTML = t.html;
    hudBar.style.width = `${(t.ready ? 1 : t.bar ?? 0) * 100}%`;
    hud.classList.toggle('ready', !!t.ready);
    hud.classList.toggle('search', !!t.search);
  }
  function tagOn(text) { hudTag.textContent = text; hud.classList.add('tagged'); task.tagT = 0; }
  function stopTaskAnim() {
    hud.classList.remove('complete', 'out', 'enter', 'in', 'tagged');
    task.phase = null; task.next = null; task.tagT = 0;
  }
  function startEnter() {
    const t = task.next;
    task.next = null;
    task.cur = { ...t, completed: false };
    hud.classList.remove('complete', 'out', 'in', 'enter');
    paintTask(t);
    void hud.offsetWidth;   // 重新触发 CSS 动画
    hud.style.setProperty('--k', 0);
    hud.classList.add('enter');
    tagOn(tx('新目标', 'NEW OBJECTIVE'));
    task.phase = 'in'; task.t = 0;
  }
  function startComplete(phase) {
    hud.classList.remove('enter', 'in', 'search');
    hud.classList.add('complete');
    tagOn(tx('已完成', 'COMPLETED'));
    task.cur.completed = true;
    task.phase = phase; task.t = 0;
  }
  function beginAdvance() {
    if (!hudVisible()) { if (task.cur) task.cur.completed = true; task.phase = 'wait'; return; }
    if (!task.cur) startEnter();
    else if (!task.cur.completed) startComplete('done');
    else { hud.classList.add('out'); task.phase = 'out'; task.t = 0; }
  }
  function setTask(t, advance) {
    const shown = task.next?.key ?? task.cur?.key;
    if (advance && t.key !== shown) {
      task.next = t;
      // 动画进行中只换目标，当前这段播完再接；slide / doneOnly 可以直接接上
      if (!task.phase || task.phase === 'doneOnly' || task.phase === 'slide') { hud.classList.remove('in'); beginAdvance(); }
      return;
    }
    if (t.key === task.next?.key) { task.next = t; return; }
    if (t.key === task.cur?.key) {
      task.cur = { ...t, completed: task.cur.completed };
      if (task.phase !== 'out') paintTask(t);
      if (task.cur.completed) hud.classList.remove('search');
      return;
    }
    // 换了上下文（进出黑梦、跳关）：直接替换，只带一个轻微滑入
    stopTaskAnim();
    task.cur = { ...t, completed: false };
    paintTask(t);
    hud.classList.add('in');
    task.phase = 'slide'; task.t = 0;
  }
  function completeTask() {
    if (!task.cur || task.cur.completed || (task.phase && task.phase !== 'slide')) return;
    hud.classList.remove('in');
    if (hudVisible()) startComplete('doneOnly');
    else { task.cur.completed = true; task.phase = null; }
  }
  function updateHud(dt) {
    if (task.tagT > 0) {
      task.tagT -= dt;
      if (task.tagT <= 0 && !task.phase) hud.classList.remove('tagged');
    }
    if (!task.phase) return;
    task.t += dt;
    switch (task.phase) {
      case 'wait': if (hudVisible()) startEnter(); break;
      case 'slide': if (task.t >= 0.46) { hud.classList.remove('in'); task.phase = null; } break;
      case 'doneOnly': if (task.t >= TASK_DONE) task.phase = null; break;
      case 'done': if (task.t >= TASK_DONE) { hud.classList.add('out'); task.phase = 'out'; task.t = 0; } break;
      case 'out': if (task.t >= TASK_OUT) startEnter(); break;
      case 'in': {
        const k = Math.min(1, task.t / TASK_SCAN);
        hud.style.setProperty('--k', 1 - (1 - k) ** 3);   // 先快后慢
        if (task.t < TASK_IN) break;
        hud.classList.remove('enter');
        task.phase = null;
        task.tagT = TASK_TAG;
        if (task.next) beginAdvance();
        break;
      }
    }
  }

  return {
    setMode(mode, label) {
      this._mode = mode;
      hud.classList.toggle('on', mode === 'explore' || mode === 'recon');
      hud.querySelector('.mode .lb').textContent = label;
      thisMode = mode;
      hint.innerHTML = hints()[mode] ?? '';
      hint.classList.toggle('recon', mode === 'recon');
      if (mode !== 'explore' && mode !== 'recon') { markers.style.opacity = 0; this.setAnalysis(null); this.hidePanel(); }
      else markers.style.opacity = 1;
      if (mode === 'cut') { clearTimeout(toastTimer); toast.classList.remove('on'); }
      sub.style.bottom = mode === 'recon' ? '250px' : '';   // 黑梦里避开时间轴
      tl.classList.toggle('on', mode === 'recon');
    },
    relabel(label) { hud.querySelector('.mode .lb').textContent = label; },
    // 平板举起时隐藏屏幕上的常驻界面
    setTabletOpen(on) {
      for (const e of [hud, hint, markers]) e.style.visibility = on ? 'hidden' : '';
      if (on) { prompt.classList.remove('on'); this.setAnalysis(null); }
    },
    // 屏幕中心的「按住 R 构建黑梦」进度环，p 为 0~1，0 时隐藏
    setDreamHold(p) {
      p = Math.min(1, p);
      dream.classList.toggle('on', p > 0);
      dreamFg.style.strokeDashoffset = `${DREAM_C * (1 - p)}`;
      // 眼睛随进度睁开，瞳孔放大，刻度圈慢慢转
      const e = 1 - (1 - p) * (1 - p);
      dreamEye.style.transform = `scaleY(${0.1 + 0.9 * e})`;
      dreamPupil.style.transform = `scale(${0.3 + 0.7 * e}) rotate(${p * 90}deg)`;
      dreamTicks.style.transform = `rotate(${p * 60}deg)`;
    },
    setTip(on) { tip.classList.toggle('on', on); },
    // 滚轮引导：html 为提示文字（null 隐藏）；goal 为时间轴上要闪烁、加箭头的黄块序号
    setGuide(html, goal = -1) {
      if (html && html !== this._guideHtml) guideText.innerHTML = html;
      this._guideHtml = html;
      guide.classList.toggle('on', !!html);
      this._goal = html ? goal : -1;
    },
    // 第一次进入黑梦的标题：a 为不透明度，k 为 0~1 的进度（字距逐渐拉开）
    setRite(a = 0, k = 0, code = '') {
      rite.style.opacity = a;
      riteT1.style.letterSpacing = `${0.3 + 0.35 * k}em`;
      if (code) rite.querySelector('.t3').textContent = code;
    },
    // 右下角「按住 TAB 跳过」：质询对话期间显示，p 为按住读条进度（0~1）
    setSkip(on, p = 0) {
      skip.classList.toggle('on', on);
      skip.classList.toggle('holding', on && p > 0);
      skipFill.style.transform = `scaleX(${on ? Math.min(1, p) : 0})`;
    },
    // 左侧任务：t = { key, html, bar(0~1), ready(黄色·黑梦就绪), search(显示「按 Q 扫描」) }
    // advance：剧情推进到新任务，播「完成 → 退出 → 新目标」；否则同 key 原地刷新（计数、换语言），换 key 直接替换
    setTask(t, { advance = false } = {}) { setTask(t, advance); },
    // 只播完成、不切新任务（黑梦里异常分析满）；之后的 advance 直接从「新目标」开始
    completeTask() { completeTask(); },
    updateHud(dt) { updateHud(dt); },
    // 左上角帧率。用真实帧间隔，暂停时也继续走。
    setFps(dt) {
      if (!(dt > 0) || dt > 1) return;
      const inst = 1 / dt;
      fpsSmooth = fpsSmooth ? fpsSmooth * 0.9 + inst * 0.1 : inst;
      const text = `${Math.round(fpsSmooth)} FPS`;
      if (text === fpsShown) return;
      fpsShown = text;
      fpsEl.textContent = text;
    },
    // list: [{ id, x, y, show, done, aim, label }]
    updateMarkers(list) {
      for (const m of list) {
        let e = markerEls.get(m.id);
        if (!e) {
          e = document.createElement('div');
          e.className = 'inv-mk';
          e.innerHTML = `<div class="d"></div><div class="snap"></div><div class="n"></div>`;
          e.style.opacity = 0;
          markers.appendChild(e);
          markerEls.set(m.id, e);
        }
        if (m.show && !e._shown && !m.flash) { e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop'); }
        if (m.flash) {
          const ring = e.querySelector('.snap');
          ring.classList.remove('go');
          void ring.offsetWidth;
          ring.classList.add('go');
        }
        e._shown = m.show;
        e.style.opacity = m.show ? 1 : 0;
        e.style.left = `${m.x}px`;
        e.style.top = `${m.y}px`;
        e.classList.toggle('done', m.done);
        e.classList.toggle('aim', m.aim);
        e.querySelector('.n').textContent = m.label;
        markPos.set(m.id, m);
      }
      if (clueId) {
        const m = markPos.get(clueId);
        if (m) placePanel(m.x, m.y, m.front);
      }
    },
    setReading(on) { readHint.classList.toggle('on', on); },
    setPrompt(text, gold = false) {
      if (text) prompt.textContent = text;
      prompt.classList.toggle('on', !!text);
      prompt.classList.toggle('gold', gold);
    },
    setAnalysis(target, p = 0, phase = 'ready') {
      const visible = target?.front && target.x > 0 && target.x < innerWidth && target.y > 0 && target.y < innerHeight;
      analysis.classList.toggle('on', !!visible);
      if (!visible) return;
      analysis.classList.toggle('working', phase === 'working');
      analysis.classList.toggle('complete', phase === 'complete');
      analysisTarget.style.left = `${target.x}px`;
      analysisTarget.style.top = `${target.y}px`;
      // Keep the readout beside the evidence, with a fixed readable size and edge clearance.
      const width = 310, height = 122, margin = 32;
      let x = target.x + 92;
      if (x + width > innerWidth - margin) x = target.x - width - 92;
      readout.style.left = `${Math.max(margin, Math.min(innerWidth - width - margin, x))}px`;
      readout.style.top = `${Math.max(margin, Math.min(innerHeight - height - margin, target.y - 142))}px`;
      const progress = Math.max(0, Math.min(1, p));
      const percent = phase === 'complete' ? 100 : Math.min(99, Math.floor(progress * 100));
      analysisPercent.textContent = `${percent}%`;
      analysisStatus.innerHTML = phase === 'complete' ? tx('分析完成', 'ANALYSIS DONE') : phase === 'working'
        ? progress < 0.3 ? tx('探头接通', 'PROBE LIVE') : progress < 0.85 ? tx('读取表面特征', 'READING SURFACE') : tx('证据比对', 'MATCHING')
        : phase === 'tap' ? '<b>E</b>'
        : tx('<b>E</b>按住分析', '<b>E</b> HOLD');
      analysisCaption.textContent = phase === 'ready' ? '' : (target.name || '');
      analysisFill.style.transform = `scaleX(${progress})`;
      analysisTrack.setAttribute('aria-valuenow', String(percent));
    },
    showClue(c, index) {
      clearTimeout(panelTimer);
      clueId = c.id;
      // 弹出面板只给最关键的一行细节（clues.js 的 main）+ 结论；完整三行留在平板的线索详情里
      const line = c.lines[c.main ?? 0];
      const lines = line ? `<div class="ln" style="animation-delay:0.15s">${line}</div>` : '';
      const dl = line ? 0.5 : 0.3;
      const no = String(index + 1).padStart(2, '0');
      const tag = c.probe ? tx('黑梦分析 · 全息重建', 'BLACK DREAM · REBUILD') : tx(`证据 #${no} · 已分析`, `EVIDENCE #${no} · DONE`);
      const pic = c.probe ? '' : `<div class="pic"><div class="img" style="background-image:url(${clueImage(c)})"></div><div class="scan"></div>
        <div class="box"></div><i class="cn a"></i><i class="cn b"></i><i class="cn c"></i><i class="cn d"></i>
        <div class="cap inv-mono">${tx('影像记录', 'STILL')} · EV-${no}</div></div>`;
      panel.innerHTML = `<div class="txt"><div class="tag inv-mono">${tag}</div><h2>${c.name}</h2>${lines}
        <div class="res" style="animation-delay:${dl}s">${c.result}</div>
        <div class="prob inv-mono" style="animation-delay:${dl + 0.2}s"><span>${tx('概率', 'PROB')}</span><div class="pb"><i></i></div><span>${Math.round(c.prob * 100)}%</span></div></div>
        ${pic}`;
      if (!panel.classList.contains('on')) sound.play('ui/panel_open');
      panel.classList.add('on');
      const m = markPos.get(c.id);
      if (m) placePanel(m.x, m.y, m.front);
      setTimeout(() => { const i = panel.querySelector('.pb i'); if (i) i.style.width = `${c.prob * 100}%`; }, (dl + 0.3) * 1000);
      panelTimer = setTimeout(() => this.hidePanel(), 5000);
    },
    // 线索卡正显示时收起才响消失音
    hidePanel() {
      clearTimeout(panelTimer);
      if (panel.classList.contains('on')) sound.play('ui/panel_close');
      panel.classList.remove('on'); panel.style.visibility = ''; clueId = null;
    },
    get panelOn() { return panel.classList.contains('on'); },
    // ms 为 0 时不自动消失，直到下一条提示或 clearToast
    toast(t1, t2, ms = 3200) {
      clearTimeout(toastTimer);
      const big = ms === 0;
      if (big) toastHold = [t1, t2];
      toast.querySelector('.t1').textContent = t1;
      toast.querySelector('.t2').textContent = t2;
      toast.classList.toggle('big', big);
      sound.play(big ? 'ui/confirm' : 'ui/toast');
      toast.classList.add('on');
      if (ms > 0) toastTimer = setTimeout(() => {
        if (toastHold) this.toast(toastHold[0], toastHold[1], 0);
        else toast.classList.remove('on', 'big');
      }, ms);
    },
    clearToast() {
      clearTimeout(toastTimer);
      toastHold = null;
      toast.classList.remove('on', 'big');
    },
    // marks：[{ t0, t1 }] 进度条上的黄块（秒）；frac 把秒换成 0~1
    buildTimeline(marks, frac, title = tx('BLACKDREAM · 黑梦回放', 'BLACKDREAM · REPLAY')) {
      const CELLS = 72;
      this._frac = frac;
      this._cells = CELLS;
      this._evSpan = marks.map((e) => [frac(e.t0), frac(e.t1)]);
      const strip = Array.from({ length: CELLS }, (_, i) => `<i data-i="${i}"></i>`).join('');
      tl.innerHTML = `<div class="head"><span>${title}</span><span class="count inv-mono"></span></div>
        <div class="track">${strip}
        ${marks.map((e, i) => `<div class="ev" data-i="${i}"></div>`).join('')}
        <div class="clock inv-mono">00:00.0</div></div>`;
    },
    // recorded / nearIdx 按 buildTimeline 传入的标记顺序；countText 为标题右侧的计数文字
    updateTimeline(t, clockText, recorded, nearIdx, countText = '') {
      const track = tl.querySelector('.track');
      if (!track) return;
      const cells = track.querySelectorAll(':scope > i');
      const n = cells.length || this._cells || 1;
      const head = Math.round(this._frac(t) * (n - 1));
      const half = 2;
      cells.forEach((el) => {
        const i = +el.dataset.i;
        el.className = i < head - half ? 'past' : (i <= head + half ? 'now' : '');
      });
      const anchor = cells[Math.max(0, Math.min(n - 1, head))];
      const clock = tl.querySelector('.clock');
      clock.textContent = clockText;
      if (anchor) {
        const cr = track.getBoundingClientRect();
        const ar = anchor.getBoundingClientRect();
        clock.style.left = `${ar.left - cr.left + ar.width / 2}px`;
      }
      tl.querySelector('.count').textContent = countText;
      const cr = track.getBoundingClientRect();
      const xAt = (f) => {
        const x = Math.max(0, Math.min(n - 1, f * (n - 1)));
        const i = Math.min(n - 1, Math.floor(x + 1e-6));
        const cell = cells[i].getBoundingClientRect();
        if (i >= n - 1) return cell.right;
        const next = cells[i + 1].getBoundingClientRect();
        return cell.left + (next.left - cell.left) * (x - i);
      };
      tl.querySelectorAll('.ev').forEach((e) => {
        const i = +e.dataset.i;
        e.classList.toggle('rec', recorded[i]);
        e.classList.toggle('near', i === nearIdx);
        e.classList.toggle('goal', i === this._goal);
        const span = this._evSpan[i] ?? [0, 0];
        const left = xAt(span[0]);
        const right = xAt(span[1]);
        e.style.left = `${left - cr.left}px`;
        e.style.width = `${Math.max(2, right - left)}px`;
      });
    },
    // 字幕逐条显示，返回 Promise<boolean>：播完为 true，被打断为 false。who 为空是内心独白；radio 为无线电通话
    // 字幕随语言切换；有配音时等 FMOD 真正播完，没有配音时按阅读时长
    say(lines, options) { return dialogue.say(lines, options); },
    updateDialogue(dt) { if (!document.hidden) dialogue.update(dt); },
    setCinema(on) { cine.classList.toggle('on', on); sub.classList.toggle('lift', on); },
    hush() { dialogue.cancel(); },
    get talking() { return dialogue.playing; },
    // 黑场：a 为不透明度，ms 为过渡时长
    black(a, ms = 0) { black.style.transition = `opacity ${ms}ms`; black.style.opacity = a; },
    // 终章字幕「序章 · 完」：结局动画黑屏后淡入，停在这一屏
    fin(on) {
      if (on) fin.style.transition = 'opacity 2s ease';
      fin.classList.toggle('on', on);
    },
    // 结局黑场文字：{ title, lines, back }；传 null 隐藏
    ending(d) {
      if (!d) { ending.classList.remove('on'); return; }
      ending.innerHTML = `<h1>${d.unlock ? `<span>${d.unlock}</span>${tx('：', ': ')}` : ''}${d.title}</h1>`
        + d.lines.map((l, i) => `<div class="ln" style="animation-delay:${0.8 + i * 1.1}s">${l}</div>`).join('')
        + `<div class="back" style="animation-delay:${1.2 + d.lines.length * 1.1}s">${d.back}</div>`;
      ending.classList.add('on');
    },
  };
}
