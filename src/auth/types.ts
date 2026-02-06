export type AppUser = {
  uid: string;
  id: string;
};

export type AppUserRow = {
  uid: string;
  id: string;
  salt: string;
  password_hash: string;
  created_at?: string;
};


