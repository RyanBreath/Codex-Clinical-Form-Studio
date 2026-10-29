import { useEffect, useState } from "react";
import { api } from "./api";
export function SessionControls() {
  const [token, setToken] = useState("");
  useEffect(() => { let live = true; void api<{ token: string }>("/csrf").then(value => { if (live) setToken(value.token); }); return () => { live = false; }; }, []);
  return <form method="post" action="/api/auth/logout"><input type="hidden" name="__RequestVerificationToken" value={token} /><button disabled={!token} type="submit">登出</button></form>;
}
