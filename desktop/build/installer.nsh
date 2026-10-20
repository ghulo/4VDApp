; 4VD's own words and pages for the installer (electron-builder includes this file).
; The install is three pages: a welcome, the progress bar, and "4VD is ready" with
; Open 4VD ticked. Updates run silently, so they skip every page.

; Always for this Windows user only, so it never asks for an administrator and never
; shows the "for me or for everyone" page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(fvdWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(fvdWelcomeText)"
  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_WELCOME

  ; The finish page comes later from electron-builder; its words are set here, before it.
  !define MUI_FINISHPAGE_TITLE "$(fvdFinishTitle)"
  !define MUI_FINISHPAGE_TEXT "$(fvdFinishText)"
  !define MUI_FINISHPAGE_RUN_TEXT "$(fvdOpen)"
!macroend

!macro customHeader
  LangString fvdWelcomeTitle ${LANG_ENGLISH} "Welcome to 4VD"
  LangString fvdWelcomeTitle ${LANG_ALBANIAN} "Mirë se vini në 4VD"
  LangString fvdWelcomeText ${LANG_ENGLISH} "The shop's dashboard and Counter, as a program on this computer.$\r$\n$\r$\n4VD installs just for you and keeps itself up to date.$\r$\n$\r$\nClick Next to install."
  LangString fvdWelcomeText ${LANG_ALBANIAN} "Paneli dhe Arka e dyqanit, si program në këtë kompjuter.$\r$\n$\r$\n4VD instalohet vetëm për ju dhe përditësohet vetë.$\r$\n$\r$\nKlikoni Tjetër për ta instaluar."
  LangString fvdFinishTitle ${LANG_ENGLISH} "4VD is ready"
  LangString fvdFinishTitle ${LANG_ALBANIAN} "4VD është gati"
  LangString fvdFinishText ${LANG_ENGLISH} "You'll find 4VD on the desktop and in the Start menu."
  LangString fvdFinishText ${LANG_ALBANIAN} "4VD gjendet në desktop dhe në menynë Start."
  LangString fvdOpen ${LANG_ENGLISH} "Open 4VD"
  LangString fvdOpen ${LANG_ALBANIAN} "Hap 4VD"
!macroend

; electron-builder recreates shortcuts on an update only if they are still there,
; so a PC that lost them (or never had them) stayed without. The Start menu entry
; always comes back; the desktop one only on a real install, so deleting it sticks.
!macro customInstall
  ${ifNot} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endIf}
  ${ifNot} ${isUpdated}
  ${andIfNot} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}
!macroend
