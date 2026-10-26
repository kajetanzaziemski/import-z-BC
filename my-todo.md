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

# Ustawienia sidebar

## Time triggers in the 3rd tab

Third tab (that now holds nothing) should say "Auto-odświeżanie".

It should show current settings as read from actual triggers set for the user^1:
> Aktualne ustawienia:
> Odświeżanie co: [1] [dni/h]
> Następne odświeżenie: [2026-10-27 11:15:00 UTC+2].
> 
> Ostatnio odświeżone:
> [2026-10-25 11:15:00 UTC+2]. Czas odświeżania [27 m 11 s].
> Odświeżone arkusze:
> [Dane dla Konfiguracja 1]
> [Dane o fakturach]
> [Dane ...]
> ...
>
> Zmień ustawienia:
> <button> Ustaw wg. danych w arkuszu </button>
> (odświeżanie co [2] [dni/h]; nast. odśw. 2026-11-17 14:30:00 UTC+2)

The button only active if current settings are different. 

The panel should refresh with poll every 1-3 s.

1 - if there is indication that there is another trigger set by another user the sidebar should be based on that info with a prompt saying:
> Odświeżanie ustawione przez innego użytkownika - poniższe informacje mogą zawierać błędy. 

## Managing script quirks and internal paths

Some parts of the script require caching, document properties etc. Some form of managament should be available for the user. For example:

### Caching settings sheet (config sheet list)

A check should be available on what is cached and a force refresh button to repopulate the cache.

# [DONE] Guarding agains stale data in query area

When coediting config sheet a 'shorter' query line does not replace a full width of the query window (cols B-F). Rather than clearing everything we should allow for keeping stale content but:
a. it should be marked with gray font (that goes back to normal when the field is changed)
b. when constructing the query, we should only read up to the max length for the given field, that is:
b. 1. For table and extendTable - 2 cells
b. 2. For queryOption and extendOption:
b. 2. 1. limit and select - 3 cells
b. 2. 2. filterLogic and orderBy - 4 cells
b. 2. 3. filter - 5 cells

Not fully completed lines should gray out anything that is unknown yet (ie. only live 'active' fields for which dval is set or value is already expected); query constructor should ignore them altogether.

# Preview request for a config sheet


# Live check fails to check

_empty_