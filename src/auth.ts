import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";

const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = "7d";

function getPrisma(db: D1Database): PrismaClient {
  const adapter = new PrismaD1(db);
  return new PrismaClient({ adapter } as unknown as ConstructorParameters<
    typeof PrismaClient
  >[0]);
}

function getJwtSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export interface AuthPayload {
  userId: string;
  email: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createToken(
  payload: AuthPayload,
  secret: string
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(getJwtSecret(secret));
}

export async function verifyToken(
  token: string,
  secret: string
): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(secret));
    return {
      userId: payload.userId as string,
      email: payload.email as string
    };
  } catch {
    return null;
  }
}

export async function handleRegister(
  request: Request,
  env: { DB: D1Database; JWT_SECRET: string }
): Promise<Response> {
  try {
    const { email, password } = (await request.json()) as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return Response.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return Response.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const prisma = getPrisma(env.DB);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return Response.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash }
    });

    const token = await createToken(
      { userId: user.id, email: user.email },
      env.JWT_SECRET
    );

    return Response.json({ token, userId: user.id, email: user.email });
  } catch (error) {
    console.error("Register error:", error);
    return Response.json({ error: "Registration failed" }, { status: 500 });
  }
}

export async function handleLogin(
  request: Request,
  env: { DB: D1Database; JWT_SECRET: string }
): Promise<Response> {
  try {
    const { email, password } = (await request.json()) as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return Response.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const prisma = getPrisma(env.DB);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return Response.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return Response.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const token = await createToken(
      { userId: user.id, email: user.email },
      env.JWT_SECRET
    );

    return Response.json({ token, userId: user.id, email: user.email });
  } catch (error) {
    console.error("Login error:", error);
    return Response.json({ error: "Login failed" }, { status: 500 });
  }
}

export async function handleMe(
  request: Request,
  env: { DB: D1Database; JWT_SECRET: string }
): Promise<Response> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await verifyToken(authHeader.slice(7), env.JWT_SECRET);
  if (!payload) {
    return Response.json({ error: "Invalid token" }, { status: 401 });
  }

  return Response.json({ userId: payload.userId, email: payload.email });
}
