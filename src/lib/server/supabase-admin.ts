import { createClient } from "@supabase/supabase-js";
import { ConfigError } from "./errors";
import type { AuthAdmin } from "./provisioning";

/** Cliente administrativo do Supabase (chave secret). SOMENTE no servidor e em scripts. */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new ConfigError("Supabase não configurado (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY).");
  return createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function createAuthAdmin(): AuthAdmin {
  const client = createSupabaseAdminClient();
  return {
    async createUser({ email, password, role }) {
      const { data, error } = await client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { ecohorta_role: role },
      });
      if (error || !data.user) throw new Error(`Não foi possível criar a conta: ${error?.message ?? "sem resposta"}`);
      return data.user.id;
    },
    async deleteUser(userId) {
      await client.auth.admin.deleteUser(userId);
    },
  };
}
