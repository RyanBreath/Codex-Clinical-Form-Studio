import { getChatGPTUser } from "./chatgpt-auth";
import StudioClient from "./StudioClient";

export default async function Home() {
  const user = await getChatGPTUser();
  return <StudioClient actor={user ? { name: user.displayName, email: user.email } : null} />;
}
