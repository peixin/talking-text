"use server";

export async function login(formData: FormData): Promise<void> {
  const email = formData.get("email");
  const password = formData.get("password");
  void email;
  void password;
  throw new Error("login: not implemented — backend auth 尚未接入");
}
