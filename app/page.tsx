import { getChatGPTUser, chatGPTSignInPath } from "./chatgpt-auth";
import Console from "./console";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getChatGPTUser();
  if (!user) return <main className="signin-card"><div className="brand-mark">M</div><h1>MYBOX · GPT 연결</h1><p>ChatGPT 계정으로 로그인하면 내 MYBOX 연결을 설정할 수 있어요.</p><a className="primary-link" href={chatGPTSignInPath("/")} target="_top">ChatGPT로 로그인</a></main>;
  return <Console displayName={user.displayName} />;
}
