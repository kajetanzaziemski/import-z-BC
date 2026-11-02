# [DONE, not yet checked on a real spreadsheet] Auto refresh

Implemented on branch better-auto-refresh: line "refreshTime" (D = time of day, formatted HH:mm and right aligned once, when the line is made - a legacy sheet gets it directly below refreshFrequency, refreshStatus directly below it; "17:30", "17", "5:30 PM" are understood; days -> atHour + nearMinute, hours -> nearMinute ONLY, the hour is ignored; the platform only promises "near"),
E of "refreshTime" names the time zone the time is in (the spreadsheet's; the trigger is created with inTimezone), every zone in the sheet is written as UTC+N (also E of lastRefresh, which used to hold CEST etc.),
line "refreshStatus" (C:E merged, green / red thick border), toast "BŁĄD! Zobacz Import z BC -> Ustawienia." when even the message cannot be written. New sheets get both lines;
an older sheet gets them (after refreshFrequency) the first time a message is written. "Następne odświeżenie" is an estimate (triggers do not expose their next run). Not done: the sidebar tab below.

# Ustawienia sidebar

## [DONE, not yet checked on a real spreadsheet] Time triggers in the 3rd tab (Auto Refresh Panel.js; the last run's duration and result sheets are recorded on the permit by the scheduled run)

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