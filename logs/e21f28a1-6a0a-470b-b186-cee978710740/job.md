Set up email monitoring system for nolah@gmx.net with the following tasks:

1. **Email Setup & Test:**
   - Configure email access using GMX IMAP settings (imap.gmx.net, mail.gmx.net)
   - Credentials: nolah@gmx.net / l1ILpVmQ44mSdK
   - Send test email to flo@ritzelmut.de with subject "Test email from thepopebot" and basic content
   - Verify email sending works properly

2. **Email Monitoring System:**
   - Create a skill/script that connects to IMAP server and checks for new emails
   - Implement email parsing and analysis functionality
   - Set up secure credential storage in operating_system/ files

3. **Automation Setup:**
   - Add cron job to operating_system/CRONS.json that runs every 30 minutes
   - Configure the cron to check emails, analyze content, and send Telegram notifications for new messages
   - Include email sender, subject, and content summary in notifications

4. **Security & Organization:**
   - Store email credentials securely (add to LLM_SECRETS since the agent needs access)
   - Create proper error handling and logging
   - Test the complete workflow end-to-end

The system should be ready to automatically monitor emails and send you Telegram notifications whenever new messages arrive.