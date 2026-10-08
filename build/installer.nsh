; Token Lens 自定义 NSIS 脚本（electron-builder-installer.yml 的 nsis.include）
;
; 卸载时清理「模型监测 → 响应核验」写到应用目录之外的东西，与应用内「关闭采集」
; （electron/agent-response-capture.ts 的 disableClaudeCapture / disableOpenCodeCapture）
; 逐项对应：
;   1. HKCU\Environment\BUN_OPTIONS 里我们追加的 --preload=<用户目录>/.claude/token-lens-monitor/claude.cjs
;      只去掉这一段；去掉后为空才删除该值，否则写回剩余部分（用户自己的选项原样保留）
;   2. %USERPROFILE%\.claude\token-lens-monitor\ 下的 claude.cjs、_token-lens-fetch-models.cjs、claude-journal.json
;      逐个核对首行标记 / 内容，是我们写的才删；目录空了才删（RMDir 不带 /r）
;   3. OpenCode 插件目录（%OPENCODE_CONFIG_DIR% 或 %USERPROFILE%\.config\opencode）\plugins\ 下的
;      token-lens-response-monitor.js 与 _token-lens-fetch-models.cjs，同样核对首行标记；插件目录本身不删
; 升级安装时旧版卸载程序也会被调用（带 --updated），这时什么都不做，免得每次升级都把用户的采集关掉。
; 采集日志在应用数据目录（%APPDATA%\Token Lens\model-responses），随 deleteAppDataOnUninstall 的设置走，这里不碰。
;
; 首行标记必须与 agent-response-capture.ts 中的常量一致（electron/capture-uninstall.test.ts 会核对）。

!define TL_CLAUDE_MARKER "// Token Lens Claude monitor"
!define TL_OPENCODE_MARKER "// Token Lens response monitor"
!define TL_HELPER_MARKER "// Shared in-process observer: metadata only, bounded frames, unchanged response bytes."
!define TL_HELPER_NAME "_token-lens-fetch-models.cjs"

!ifdef BUILD_UNINSTALLER
!include "WordFunc.nsh"
!include "WinMessages.nsh"

; 删除首行恰好是「标记 + 换行」的普通文件。用法：Push <路径>  Push <标记>  Call un.TLRemoveIfMarked
Function un.TLRemoveIfMarked
  Exch $R1
  Exch
  Exch $R0
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  IfFileExists "$R0" 0 tl_rim_done
  ; 同名目录不是我们创建的
  IfFileExists "$R0\*.*" tl_rim_keep 0
  ClearErrors
  FileOpen $R2 "$R0" r
  IfErrors tl_rim_keep
  FileRead $R2 $R3 1024
  FileClose $R2
  StrLen $R4 $R1
  StrCpy $R5 $R3 $R4
  StrCmpS $R5 $R1 0 tl_rim_keep
  ; 标记后面必须紧跟换行（与 TS 里 startsWith(marker + "\n") 一致）
  StrCpy $R5 $R3 1 $R4
  StrCmpS $R5 "$\n" 0 tl_rim_keep
  Delete "$R0"
  DetailPrint "Token Lens: removed $R0"
  Goto tl_rim_done
tl_rim_keep:
  DetailPrint "Token Lens: kept $R0 (not created by Token Lens)"
tl_rim_done:
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R0
  Pop $R1
FunctionEnd

; claude-journal.json：内容是一个 JSON 字符串，指向 ...\model-responses\claude-code.jsonl
Function un.TLRemoveJournalPointer
  Exch $R0
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  IfFileExists "$R0" 0 tl_rjp_done
  IfFileExists "$R0\*.*" tl_rjp_keep 0
  ClearErrors
  FileOpen $R2 "$R0" r
  IfErrors tl_rjp_keep
  FileRead $R2 $R3 1024
  FileClose $R2
  StrCpy $R4 $R3 1
  StrCmpS $R4 '"' 0 tl_rjp_keep
  ; JSON 里反斜杠写作 \\ ；正斜杠版本也认。后缀长度运行时计算，免得手算出错
  StrCpy $R5 '\\model-responses\\claude-code.jsonl"'
  StrLen $R6 $R5
  IntOp $R6 0 - $R6
  StrCpy $R4 $R3 "" $R6
  StrCmpS $R4 $R5 tl_rjp_delete 0
  StrCpy $R5 '/model-responses/claude-code.jsonl"'
  StrLen $R6 $R5
  IntOp $R6 0 - $R6
  StrCpy $R4 $R3 "" $R6
  StrCmpS $R4 $R5 tl_rjp_delete tl_rjp_keep
tl_rjp_delete:
  Delete "$R0"
  DetailPrint "Token Lens: removed $R0"
  Goto tl_rjp_done
tl_rjp_keep:
  DetailPrint "Token Lens: kept $R0 (not created by Token Lens)"
tl_rjp_done:
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R0
FunctionEnd

; 从 HKCU\Environment\BUN_OPTIONS 去掉我们那一段。算法与 stripBunPreloadFlag 相同：
; 两边补空格 -> 反复把 " <flag> " 换成 " " -> 去掉补上的空格；结果为空删除该值，否则写回。
Function un.TLStripBunOptions
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  ClearErrors
  ReadRegStr $R0 HKCU "Environment" "BUN_OPTIONS"
  IfErrors tl_sbo_done
  StrCmp $R0 "" tl_sbo_done
  ${WordReplaceS} "$PROFILE" "\" "/" "+" $R1
  StrCpy $R1 "--preload=$R1/.claude/token-lens-monitor/claude.cjs"
  StrCpy $R2 " $R0 "
tl_sbo_loop:
  ${WordReplaceS} "$R2" " $R1 " " " "+" $R3
  StrCmpS $R3 $R2 tl_sbo_trim
  StrCpy $R2 $R3
  Goto tl_sbo_loop
tl_sbo_trim:
  StrCpy $R2 $R2 "" 1
  StrCpy $R2 $R2 -1
  StrCmpS $R2 $R0 tl_sbo_done
  StrCmp $R2 "" 0 tl_sbo_write
  DeleteRegValue HKCU "Environment" "BUN_OPTIONS"
  DetailPrint "Token Lens: removed HKCU\Environment\BUN_OPTIONS"
  Goto tl_sbo_notify
tl_sbo_write:
  WriteRegStr HKCU "Environment" "BUN_OPTIONS" "$R2"
  DetailPrint "Token Lens: removed $R1 from HKCU\Environment\BUN_OPTIONS"
tl_sbo_notify:
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=1000
tl_sbo_done:
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

Function un.TLCleanupAgentCapture
  Push $R0
  ; Claude Code
  Call un.TLStripBunOptions
  Push "$PROFILE\.claude\token-lens-monitor\claude.cjs"
  Push "${TL_CLAUDE_MARKER}"
  Call un.TLRemoveIfMarked
  Push "$PROFILE\.claude\token-lens-monitor\${TL_HELPER_NAME}"
  Push "${TL_HELPER_MARKER}"
  Call un.TLRemoveIfMarked
  Push "$PROFILE\.claude\token-lens-monitor\claude-journal.json"
  Call un.TLRemoveJournalPointer
  ; 不带 /r：目录里还有别的文件就保留
  RMDir "$PROFILE\.claude\token-lens-monitor"
  ; OpenCode
  ReadEnvStr $R0 OPENCODE_CONFIG_DIR
  StrCmp $R0 "" 0 +2
  StrCpy $R0 "$PROFILE\.config\opencode"
  Push "$R0\plugins\token-lens-response-monitor.js"
  Push "${TL_OPENCODE_MARKER}"
  Call un.TLRemoveIfMarked
  Push "$R0\plugins\${TL_HELPER_NAME}"
  Push "${TL_HELPER_MARKER}"
  Call un.TLRemoveIfMarked
  Pop $R0
FunctionEnd
!endif

!macro customUnInstall
  ${ifNot} ${isUpdated}
    Call un.TLCleanupAgentCapture
  ${endIf}
!macroend
