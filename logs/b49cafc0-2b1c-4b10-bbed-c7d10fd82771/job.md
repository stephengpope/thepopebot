Create a financial advisor agent with the following components:

1. **Directory Structure**: Create `operating_system/FINANCIAL_ADVISOR/` folder with:
   - `FINANCIAL_ADVISOR.md` - defines the agent's daily research tasks and methodology
   - `FINANCIAL_REPORT_TEMPLATE.md` - structured template for daily reports
   - `FINANCIAL_REPORT.md` - will contain the most recent daily report

2. **Cron Job Configuration**: Add a new cron job to `operating_system/CRONS.json` that:
   - Runs daily at 6:00 AM CET (4:00 AM UTC)
   - Uses agent type to perform market research
   - References the FINANCIAL_ADVISOR.md task file

3. **Task Definition**: The FINANCIAL_ADVISOR.md should define comprehensive market research including:
   - Major market indices analysis
   - Sector performance review
   - Economic indicators and news
   - Currency and commodity updates
   - Risk assessment and outlook

4. **Report Template**: The FINANCIAL_REPORT_TEMPLATE.md should structure reports with:
   - Executive summary
   - Market performance metrics
   - Sector analysis
   - Key news and events
   - Recommendations and outlook
   - Risk factors

The agent will generate web-based research, analyze current market conditions, and produce a structured daily report saved as FINANCIAL_REPORT.md.