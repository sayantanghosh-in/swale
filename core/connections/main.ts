import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { ConnectionsSchema, type ConnectionsRecord } from "../models.js";

export const createConnectionsObject = (
  provider: ConnectionsRecord["provider"],
  login: string,
  name: string,
  avatarUrl: string,
  profileUrl: string,
  linkedTo: string,
  meta?: any,
): { success: boolean; connectionsObj: ConnectionsRecord } => {
  const currentDate = new Date();
  const connectionsObj: ConnectionsRecord = {
    id: randomUUID(),
    provider,
    login,
    name,
    avatarUrl,
    profileUrl,
    connectedAt: currentDate,
    lastSyncedAt: currentDate,
    linkedTo,
    meta,
  };
  const parseResult = ConnectionsSchema.safeParse(connectionsObj);

  return {
    success: parseResult.success,
    connectionsObj,
  };
};

export const insertConnection = (connectionsObj: ConnectionsRecord): { success: boolean } => {
  const preparedInsert = db.prepare(`
    INSERT INTO connections
      (id, provider, login, name, avatar_url, profile_url, connected_at, last_synced_at, meta, linked_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(linked_to, provider) DO UPDATE SET
      login          = excluded.login,
      name           = excluded.name,
      avatar_url     = excluded.avatar_url,
      profile_url    = excluded.profile_url,
      last_synced_at = excluded.last_synced_at,
      meta           = excluded.meta
  `);
  const ranInsertStatement = preparedInsert.run(
    connectionsObj?.id,
    connectionsObj?.provider,
    connectionsObj?.login,
    connectionsObj?.name,
    connectionsObj?.avatarUrl,
    connectionsObj?.profileUrl,
    connectionsObj?.connectedAt.toISOString(),
    connectionsObj?.lastSyncedAt.toISOString(),
    JSON.stringify(connectionsObj?.meta ?? {}),
    connectionsObj?.linkedTo,
  );
  return {
    success: ranInsertStatement?.changes === 1,
  };
};

export const validateGithubLoginWithExistingConnection = (
  userId: string,
  githubLogin: string,
): { success: boolean } => {
  const matchingConnection = db
    .prepare("SELECT * FROM connections where linked_to = ? AND login = ? AND provider = 'github'")
    .get(userId, githubLogin);
  return {
    success: typeof matchingConnection?.id === "string" && matchingConnection?.id?.length > 0,
  };
};

/** Looks up the stored login for any provider, github included. */
export const fetchLoginByProvider = (
  userId: string,
  provider: ConnectionsRecord["provider"],
): { success: boolean; login: string } => {
  const matchingConnection = db
    .prepare("SELECT id, login FROM connections where linked_to = ? AND provider = ?")
    .get(userId, provider);
  return {
    success: typeof matchingConnection?.id === "string" && matchingConnection?.id?.length > 0,
    login: matchingConnection?.login as string,
  };
};
