import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { configureApp } from "./../src/bootstrap";
import { PrismaService } from "./../src/prisma/prisma.service";

// Shared app + token state — rebuilt once per suite for speed.
let app: INestApplication;
let prisma: PrismaService;

// alice's credentials
const ALICE = { email: "e2e-alice@test.invalid", password: "TestPass123!" };
const BOB = { email: "e2e-bob@test.invalid", password: "TestPass123!" };
let aliceToken: string;
let bobToken: string;
let aliceRefreshCookie: string;

async function register(creds: {
  email: string;
  password: string;
}): Promise<{ accessToken: string; setCookie: string }> {
  const res = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .send(creds)
    .expect(201);
  return {
    accessToken: res.body.accessToken as string,
    setCookie: (res.headers["set-cookie"] as unknown as string[])?.[0] ?? "",
  };
}

beforeAll(async () => {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = configureApp(moduleFixture.createNestApplication());
  await app.init();

  prisma = app.get(PrismaService);

  // Wipe e2e users from any prior run, then recreate.
  await prisma.session.deleteMany({
    where: { user: { email: { in: [ALICE.email, BOB.email] } } },
  });
  await prisma.todo.deleteMany({
    where: { user: { email: { in: [ALICE.email, BOB.email] } } },
  });
  await prisma.user.deleteMany({
    where: { email: { in: [ALICE.email, BOB.email] } },
  });

  const alice = await register(ALICE);
  aliceToken = alice.accessToken;
  aliceRefreshCookie = alice.setCookie;

  const bob = await register(BOB);
  bobToken = bob.accessToken;
});

afterAll(async () => {
  // Clean up test data then close.
  await prisma.session.deleteMany({
    where: { user: { email: { in: [ALICE.email, BOB.email] } } },
  });
  await prisma.todo.deleteMany({
    where: { user: { email: { in: [ALICE.email, BOB.email] } } },
  });
  await prisma.user.deleteMany({
    where: { email: { in: [ALICE.email, BOB.email] } },
  });
  await app.close();
});

describe("Auth", () => {
  it("rejects duplicate registration with 409 CONFLICT", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send(ALICE)
      .expect(409);
    expect(res.body.code).toBe("EMAIL_TAKEN");
  });

  it("logs in with correct credentials and returns accessToken", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send(ALICE)
      .expect(200);
    expect(typeof res.body.accessToken).toBe("string");
  });

  it("rejects login with wrong password — 401 INVALID_CREDENTIALS", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: ALICE.email, password: "wrong" })
      .expect(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("refreshes using the httpOnly cookie and returns a new accessToken", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", aliceRefreshCookie)
      .expect(200);
    expect(typeof res.body.accessToken).toBe("string");
    // new Set-Cookie must be present (token rotated)
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("returns 401 when no refresh cookie is present", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .expect(401);
    expect(res.body.code).toBe("NO_REFRESH_TOKEN");
  });

  it("protects todos — unauthenticated request returns 401", async () => {
    await request(app.getHttpServer()).get("/api/v1/todos").expect(401);
  });
});

describe("Todos — CRUD", () => {
  it("creates a todo and lists it back via cursor pagination", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/todos")
      .auth(aliceToken, { type: "bearer" })
      .send({ title: "e2e: create + list" })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get("/api/v1/todos")
      .auth(aliceToken, { type: "bearer" })
      .expect(200);

    expect(list.body).toHaveProperty("items");
    expect(list.body).toHaveProperty("nextCursor");
    expect(
      (list.body.items as Array<{ title: string }>).some(
        (t) => t.title === "e2e: create + list",
      ),
    ).toBe(true);
  });

  it("exposes an ETag on GET /:id equal to the version number", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/v1/todos")
      .auth(aliceToken, { type: "bearer" })
      .send({ title: "e2e: etag check" })
      .expect(201);

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/todos/${created.body.id}`)
      .auth(aliceToken, { type: "bearer" })
      .expect(200);

    expect(fetched.headers.etag).toBe(`"${created.body.version}"`);
  });

  it("deletes a todo and returns 404 on subsequent GET", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/v1/todos")
      .auth(aliceToken, { type: "bearer" })
      .send({ title: "e2e: delete me" })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/todos/${created.body.id}`)
      .auth(aliceToken, { type: "bearer" })
      .expect(204);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/todos/${created.body.id}`)
      .auth(aliceToken, { type: "bearer" })
      .expect(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("rejects a body with unknown fields (whitelist validation)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/todos")
      .auth(aliceToken, { type: "bearer" })
      .send({ title: "valid", id: "attacker-id", createdAt: "1999-01-01" })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a title that is missing or over 500 chars", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/todos")
      .auth(aliceToken, { type: "bearer" })
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .post("/api/v1/todos")
      .auth(aliceToken, { type: "bearer" })
      .send({ title: "x".repeat(501) })
      .expect(400);
  });

  it("rejects notes over 10 000 chars (DoS guard)", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/todos")
      .auth(aliceToken, { type: "bearer" })
      .send({ title: "big", notes: "x".repeat(10_001) })
      .expect(400);
  });
});

describe("Todos — optimistic concurrency", () => {
  let todoId: string;
  let version: number;

  beforeAll(async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/todos")
      .auth(aliceToken, { type: "bearer" })
      .send({ title: "concurrency test todo" })
      .expect(201);
    todoId = res.body.id as string;
    version = res.body.version as number;
  });

  it("PATCH with correct If-Match increments version", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/todos/${todoId}`)
      .auth(aliceToken, { type: "bearer" })
      .set("If-Match", String(version))
      .send({ completed: true })
      .expect(200);

    expect(res.body.version).toBe(version + 1);
    expect(res.headers.etag).toBe(`"${version + 1}"`);
    version = res.body.version as number;
  });

  it("PATCH with stale If-Match returns 412 VERSION_CONFLICT with current version", async () => {
    const stale = version - 1;
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/todos/${todoId}`)
      .auth(aliceToken, { type: "bearer" })
      .set("If-Match", String(stale))
      .send({ title: "conflict" })
      .expect(412);

    expect(res.body.code).toBe("VERSION_CONFLICT");
    expect(res.body.current).toBe(version);
  });
});

describe("Todos — idempotency", () => {
  const CLIENT_REQ_ID = "e2e00000-0000-7000-8000-000000000001";

  it("double POST with same clientRequestId → 1 row, second returns 200 with same id", async () => {
    const first = await request(app.getHttpServer())
      .post("/api/v1/todos")
      .auth(aliceToken, { type: "bearer" })
      .send({ title: "idempotent todo", clientRequestId: CLIENT_REQ_ID })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post("/api/v1/todos")
      .auth(aliceToken, { type: "bearer" })
      .send({ title: "idempotent todo", clientRequestId: CLIENT_REQ_ID })
      .expect(200);

    expect(second.body.id).toBe(first.body.id);

    // Only one row in DB.
    const count = await prisma.todo.count({
      where: { clientRequestId: CLIENT_REQ_ID },
    });
    expect(count).toBe(1);
  });
});

describe("Todos — tenant isolation", () => {
  let aliceTodoId: string;

  beforeAll(async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/todos")
      .auth(aliceToken, { type: "bearer" })
      .send({ title: "alice private todo" })
      .expect(201);
    aliceTodoId = res.body.id as string;
  });

  it("Bob cannot read Alice's todo by ID — receives 404", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/todos/${aliceTodoId}`)
      .auth(bobToken, { type: "bearer" })
      .expect(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("Bob's todo list does not include Alice's todos", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/todos")
      .auth(bobToken, { type: "bearer" })
      .expect(200);

    const ids = (res.body.items as Array<{ id: string }>).map((t) => t.id);
    expect(ids).not.toContain(aliceTodoId);
  });

  it("Bob cannot delete Alice's todo — receives 404", async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/todos/${aliceTodoId}`)
      .auth(bobToken, { type: "bearer" })
      .expect(404);
  });
});
