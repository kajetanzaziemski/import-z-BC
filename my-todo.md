# Regular checkup for time triggers

To deal with crashed triggers run a separate clock trigger - a "medic" - that would check for jobs done by all other triggers.

Medic should run every hour, read all user's permits in look for a mismatch between lastFired and lastRun. On an idetified problem:
1) Find and redo the log entry for the identified run: Mark it as failed with status "Błąd [!] Przekroczono maksymalny czas wykonania (30 min)." and add detail in the technical column with a note that it was modified by the medic. - for this job a row hash should be stored somewhere so that the medic can identify the row. If no row is found, create a new one.
2) 

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

### [DONE, not checked on a real spreadsheet] Error reporting

Done as described (docs/use-cases.md, "Error reporting of the set-up"). The error is kept in the import settings until the next set-up goes right; the sheet's red message mentions the trigger limit too; the limit is told by the platform's message (Polish / English) or by a trigger-related error with 5 clock triggers present.

in Autoodświeżanie: 

where: after last refresh info, but before Apply sheet's settings button.
what: a last reported error in setting of autorefresh (if there was one. if the setup went correctly, nothing to display). It should say the message of refreshStatus but with Szczegóły błędu collapsed by default but holding platform error. 
special treatment: if setup failed because it outrun 5 clock triggers limit per user it should say so in the main message (before the details).

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

# [DONE, not checked on a real spreadsheet] Data connection log

Done as described (docs/use-cases.md, "The download log"). Choices: one entry per refresh RUN (not per sheet); "Odświeżone arkusze" is one cell, a line per sheet; a config sheet without a table or a BC error document is a handled failure (the status, not "OK"); the name of the log sheet may not be the settings, a config or a result sheet.

For all queries to BC that result (or should result) in data write in the sheets (ie. both "Pobierz dane..." functions in the menu and auto refresh) a status message should be logged. The log is a new sheet (default name "Dziennik pobrań", customizable via Konfiguracja panel), an entry is a new line in this sheet. Insert newest first (ie. logging should insert new row above previous entries, but below headers).

## Sheet layout

The columns should include: source of refresh ("Autoodświeżanie", "Odświeżanie jednego arkusza", "Odświeżanie wszystkich arkuszy"), start time of refresh, end time, duration, status message (platform error if thrown, failure mesage if handled by the script, "OK" if no errors), number and list of sheets refreshed and no of rows in each sheet(in one cell joined as text), technical (this should say clock trigger if fired by a clock trigger and information on deleting trigger and no refresh performed if that was the case).g

## Konfiguracja for log

Add a section "Arkusz dziennika pobrań" in Ogólne settings. layout analagous to import settings sheet name settings.

# Connection with BC (Microsoft) - client secret etc. / what is the best way?