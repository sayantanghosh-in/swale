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
  };
  const parseResult = ConnectionsSchema.safeParse(connectionsObj);

  return {
    success: parseResult.success,
    connectionsObj,
  };
};

export const insertConnection = (connectionsObj: ConnectionsRecord): { success: boolean } => {
  // insert the user to the 'connections' table
  const preparedInsert = db.prepare(
    "INSERT INTO connections (id, provider, login, name, avatar_url, profile_url, connected_at, last_synced_at, linked_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const ranInsertStatement = preparedInsert.run(
    connectionsObj?.id,
    connectionsObj?.name,
    connectionsObj?.login,
    connectionsObj?.name,
    connectionsObj?.avatarUrl,
    connectionsObj?.profileUrl,
    connectionsObj?.connectedAt.toString(),
    connectionsObj?.lastSyncedAt.toString(),
    connectionsObj?.linkedTo,
  );
  return {
    success: ranInsertStatement?.changes === 1,
  };
};
