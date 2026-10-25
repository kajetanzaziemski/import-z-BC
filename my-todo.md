# Auto refresh

Extended freq area should allow for:
- setting time refresh should happen at (next refresh at?).

Message area (a merged cell) will update after changing settings:
edit in freq area -> setup / change / delete time-based trigger -> udate status message.

On success (light green background; green bold border):
> Dane będą odświeżane automatycznie co [1] [dzień/h].
> Następne odświeżenie [2026-11-29 17:00:00 UTC+2"].
> Odświeżanie zostało ustawione [2026-10-30 15:41:23 UTC+2].

On fail (ligth red background; red bold border):
> Ustawienia odświeżania nie zostały zaktualizowane!
> Zmień ustawienia, żeby spróbować ponownie lub zobacz szczegóły w menu dodatku: <b> Import z BC -> Ustawienia </b>.
> Próba zmiany ustawień została podjęta [2026-10-30 13:41:11 UTC+2].

If script fails for whatever reason before fail message could be set (incl. a fail on setting the message itself), a toast should inform about it:
> BŁĄD! Zobacz Import z BC -> Usatwienia.

# Live chack fails to check

## Pasting full row over the available empty line while another config analyze is running

Live check throws for the first run:
```
config.coedit [Konfiguracja 1] (3)
via sheetEditAction
16:42:45 · 12 s
[LIVE-CHECK] FAIL config.coedit [Konfiguracja 1] (via sheetEditAction) (11856 ms)
    PASS trigger's last use recorded
    PASS agent suspect flag cleared by the installable run
    PASS settings sheet exists with its signature (created on demand)
    PASS Konfiguracja 1 is a config sheet listed in the settings sheet
    PASS [Konfiguracja 1] config sheet exists
    WARN [Konfiguracja 1] activity indicators back to idle - still showing activity: reading (B2: background #008000, font #000000; before the run: background #cccccc, font #999999); another run is in progress and may be lighting it: sheetEditAction since 15:42:53 UTC, sheetEditAction since 15:42:49 UTC
    PASS [Konfiguracja 1] header intact (B1, B4)
    PASS [Konfiguracja 1] estimate info greyed out
    PASS [Konfiguracja 1] has a "table" row
    PASS [Konfiguracja 1] has an "extend" row
    FAIL [Konfiguracja 1] has an empty "queryOption" row - no empty queryOption row to type in
    PASS [Konfiguracja 1] has an empty "extendOption" row
    FAIL [Konfiguracja 1] dropdowns match the rows (9 rows) - D11 should be a dropdown; E11 should be a </>... dropdown
```
and for the second:
```

config.coedit [Konfiguracja 1] (2)
via sheetEditAction
16:42:53 · 16 s
[LIVE-CHECK] FAIL config.coedit [Konfiguracja 1] (via sheetEditAction) (15761 ms)
    PASS trigger's last use recorded
    PASS agent suspect flag cleared by the installable run
    PASS settings sheet exists with its signature (created on demand)
    PASS Konfiguracja 1 is a config sheet listed in the settings sheet
    PASS [Konfiguracja 1] config sheet exists
    PASS [Konfiguracja 1] activity indicators back to idle
    PASS [Konfiguracja 1] header intact (B1, B4)
    PASS [Konfiguracja 1] estimate info greyed out
    PASS [Konfiguracja 1] has a "table" row
    PASS [Konfiguracja 1] has an "extend" row
    FAIL [Konfiguracja 1] has an empty "queryOption" row - no empty queryOption row to type in
    PASS [Konfiguracja 1] has an empty "extendOption" row
    FAIL [Konfiguracja 1] dropdowns match the rows (9 rows) - D11 should be a dropdown; E11 should be a </>... dropdown
    PASS duration within limits
```

