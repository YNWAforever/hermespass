# HermesPass compliance-report workflow

`compliance-report.json` is an importable, inactive n8n workflow artifact. It schedules both report requests at 01:00 Hong Kong time on the first day of each month, saves the IMDA CSV to Google Drive, and appends the HKMA JSON summary to Google Sheets.

Before activating it, configure `HERMES_BASE_URL`, `HERMES_ORG_ID`, `HERMES_DRIVE_FOLDER_ID`, and `HERMES_SHEET_ID` in the n8n environment. Create a header-auth credential named `HERMES_REPORT_HEADER_AUTH` whose secret is supplied through the protected `REPORT_EXPORT_SECRET` environment value. Configure Google Drive and Google Sheets credentials in n8n itself. No credential or bearer secret is stored in this repository.
