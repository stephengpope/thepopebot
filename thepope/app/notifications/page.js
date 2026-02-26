import { auth } from 'thepopebot/auth';
import { NotificationsPage } from 'thepopebot/chat';

export default async function NotificationsRoute() {
  const session = await auth();
  return <NotificationsPage session={session} />;
}
