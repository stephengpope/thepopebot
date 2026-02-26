import { auth } from 'thepopebot/auth';
import { SwarmPage } from 'thepopebot/chat';

export default async function SwarmRoute() {
  const session = await auth();
  return <SwarmPage session={session} />;
}
