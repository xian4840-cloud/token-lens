; Token Lens 自定义 NSIS 脚本（electron-builder-installer.yml 的 nsis.include）
;
; 卸载时清理「模型监测 → 响应核验」写到应用目录之外的东西，与应用内「关闭采集」
; （electron/agent-response-capture.ts 的 disableClaudeCapture / disableOpenCodeCapture）
; 逐项对应：
;   1. HKCU\Environment\BUN_OPTIONS 里我们追加的 --preload=…/.claude/token-lens-monitor/claude.cjs
;      只去掉这些段（不区分大小写、正反斜杠都认、空格/制表符/换行都算分隔符）；一段不剩才删除该值，
;      否则写回剩余部分（用户自己的选项原样保留）
;   2. 复查：剩余值仍引用 token-lens-monitor/claude.cjs，或注册表写入失败，则第 3 步整套跳过
;      （Bun 找不到 --preload 指向的文件会直接退出，删了脚本 Claude Code 就起不来）
;   3. %USERPROFILE%\.claude\token-lens-monitor\ 下的 claude.cjs、_token-lens-fetch-models.cjs、claude-journal.json
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
; 与 PRELOAD_PATH_SUFFIX / PRELOAD_REFERENCE 一致（小写、正斜杠）
!define TL_PRELOAD_SUFFIX "/.claude/token-lens-monitor/claude.cjs"
!define TL_PRELOAD_REFERENCE "token-lens-monitor/claude.cjs"

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

; ---- BUN_OPTIONS 处理：逐字符实现 stripTokenLensPreload（agent-response-capture.ts），两边由测试对齐 ----
Var TLValue      ; 原值
Var TLOut        ; 结果
Var TLSep        ; 当前段之前的空白
Var TLTok        ; 当前段
Var TLCarry      ; 第一段被去掉时，留给下一个保留段用的行首空白
Var TLHasCarry
Var TLAnyKept
Var TLMatch
Var TLRemovedList
Var TLStillRef   ; 1 = 仍有东西引用 claude.cjs（或注册表写入失败），不能删脚本

; $TLTok 是否是我们的段：--preload= 开头（不区分大小写），路径统一成正斜杠后以
; ${TL_PRELOAD_SUFFIX} 结尾（StrCmp 不区分大小写）。结果写入 $TLMatch。
Function un.TLIsOurPreload
  Push $0
  Push $1
  Push $2
  StrCpy $TLMatch 0
  StrCpy $0 $TLTok 10
  StrCmp $0 "--preload=" 0 tl_iop_done
  StrCpy $0 $TLTok "" 10
  ${WordReplaceS} "$0" "\" "/" "+" $0
  StrLen $1 "${TL_PRELOAD_SUFFIX}"
  StrLen $2 $0
  IntCmp $2 $1 0 tl_iop_done 0
  IntOp $1 0 - $1
  StrCpy $2 $0 "" $1
  StrCmp $2 "${TL_PRELOAD_SUFFIX}" 0 tl_iop_done
  StrCpy $TLMatch 1
tl_iop_done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; 处理一对 ($TLSep, $TLTok)
Function un.TLProcessPair
  Call un.TLIsOurPreload
  StrCmp $TLMatch 1 0 tl_pp_keep
  StrCpy $TLRemovedList "$TLRemovedList $TLTok"
  StrCmp $TLAnyKept 1 tl_pp_done
  StrCmp $TLHasCarry 1 tl_pp_done
  StrCpy $TLCarry $TLSep
  StrCpy $TLHasCarry 1
  Goto tl_pp_done
tl_pp_keep:
  StrCmp $TLAnyKept 1 tl_pp_usesep
  StrCmp $TLHasCarry 1 0 tl_pp_usesep
  StrCpy $TLOut "$TLOut$TLCarry$TLTok"
  Goto tl_pp_kept
tl_pp_usesep:
  StrCpy $TLOut "$TLOut$TLSep$TLTok"
tl_pp_kept:
  StrCpy $TLAnyKept 1
  StrCpy $TLHasCarry 0
tl_pp_done:
FunctionEnd

; $TLValue -> $TLOut（一段不剩时为空）
Function un.TLStripValue
  Push $0
  Push $1
  Push $2
  StrCpy $TLOut ""
  StrCpy $TLSep ""
  StrCpy $TLTok ""
  StrCpy $TLCarry ""
  StrCpy $TLHasCarry 0
  StrCpy $TLAnyKept 0
  StrCpy $TLRemovedList ""
  StrCpy $0 0
  StrLen $1 $TLValue
tl_sv_loop:
  IntCmp $0 $1 tl_sv_end 0 tl_sv_end
  StrCpy $2 $TLValue 1 $0
  IntOp $0 $0 + 1
  StrCmp $2 " " tl_sv_ws
  StrCmp $2 "$\t" tl_sv_ws
  StrCmp $2 "$\r" tl_sv_ws
  StrCmp $2 "$\n" tl_sv_ws
  StrCpy $TLTok "$TLTok$2"
  Goto tl_sv_loop
tl_sv_ws:
  StrCmp $TLTok "" 0 tl_sv_flush
  StrCpy $TLSep "$TLSep$2"
  Goto tl_sv_loop
tl_sv_flush:
  Call un.TLProcessPair
  StrCpy $TLSep $2
  StrCpy $TLTok ""
  Goto tl_sv_loop
tl_sv_end:
  StrCmp $TLTok "" tl_sv_trailing
  Call un.TLProcessPair
  StrCpy $TLSep ""
tl_sv_trailing:
  ; 此时 $TLSep 是末尾空白
  StrCmp $TLAnyKept 1 0 tl_sv_empty
  StrCpy $TLOut "$TLOut$TLSep"
  Goto tl_sv_done
tl_sv_empty:
  StrCpy $TLOut ""
tl_sv_done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; $TLOut 里是否仍引用 ${TL_PRELOAD_REFERENCE}（不区分大小写、正反斜杠），是则 $TLStillRef = 1
Function un.TLCheckStillReferenced
  Push $0
  StrCmp $TLOut "" tl_csr_done
  ${WordReplaceS} "$TLOut" "\" "/" "+" $0
  ClearErrors
  ; 前面补一个字符，保证不会以分隔串开头；WordFind 不区分大小写
  ${WordFind} "x$0" "${TL_PRELOAD_REFERENCE}" "E+1{" $0
  IfErrors tl_csr_done
  StrCpy $TLStillRef 1
  DetailPrint "Token Lens: HKCU\Environment\BUN_OPTIONS still references ${TL_PRELOAD_REFERENCE}; keeping the Claude monitor files"
tl_csr_done:
  Pop $0
FunctionEnd

; 从 HKCU\Environment\BUN_OPTIONS 去掉我们的段；结果为空删除该值，否则写回；
; 写入失败或剩余值仍引用 claude.cjs 时置 $TLStillRef = 1。
Function un.TLStripBunOptions
  StrCpy $TLStillRef 0
  ClearErrors
  ReadRegStr $TLValue HKCU "Environment" "BUN_OPTIONS"
  IfErrors tl_sbo_done
  StrCmp $TLValue "" tl_sbo_done
  Call un.TLStripValue
  StrCmpS $TLOut $TLValue tl_sbo_check
  ClearErrors
  StrCmp $TLOut "" 0 tl_sbo_write
  DeleteRegValue HKCU "Environment" "BUN_OPTIONS"
  IfErrors tl_sbo_failed
  DetailPrint "Token Lens: removed HKCU\Environment\BUN_OPTIONS"
  Goto tl_sbo_notify
tl_sbo_write:
  WriteRegStr HKCU "Environment" "BUN_OPTIONS" "$TLOut"
  IfErrors tl_sbo_failed
  DetailPrint "Token Lens: removed$TLRemovedList from HKCU\Environment\BUN_OPTIONS"
tl_sbo_notify:
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=1000
tl_sbo_check:
  Call un.TLCheckStillReferenced
  Goto tl_sbo_done
tl_sbo_failed:
  StrCpy $TLStillRef 1
  DetailPrint "Token Lens: failed to update HKCU\Environment\BUN_OPTIONS; keeping the Claude monitor files"
tl_sbo_done:
FunctionEnd

Function un.TLCleanupAgentCapture
  Push $R0
  ; Claude Code
  Call un.TLStripBunOptions
  StrCmp $TLStillRef 1 tl_cac_opencode
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
tl_cac_opencode:
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
