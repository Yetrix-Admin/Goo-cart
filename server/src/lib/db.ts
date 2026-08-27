import mongoose from "mongoose";

let connecting: Promise<typeof mongoose> | null = null;

export function mongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set. Copy server/.env.example to server/.env and fill it in.");
  return uri;
}

export function dbName(): string {
  return process.env.MONGODB_DB || "goocart";
}

/**
 * Single shared connection. Mongoose pools internally, so calling this on
 * every request is safe and avoids the connection-per-request exhaustion that
 * makes Atlas unhappy.
 */
export function connectDb(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
  if (!connecting) {
    connecting = mongoose.connect(mongoUri(), {
      dbName: dbName(),
      serverSelectionTimeoutMS: 15000,
      retryWrites: true,
    });
  }
  return connecting;
}

export async function disconnectDb(): Promise<void> {
  connecting = null;
  await mongoose.disconnect();
}

/** True when the cluster is a replica set / Atlas, i.e. transactions work. */
export function supportsTransactions(): boolean {
  return Boolean(mongoose.connection.db) && mongoose.connection.readyState === 1;
}
