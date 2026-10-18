import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { configureApp } from "./../src/bootstrap";

describe("Todos (e2e)", () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = configureApp(moduleFixture.createNestApplication());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const url = "/api/v1/todos";

  it("lists the seeded todos under the versioned prefix", async () => {
    const res = await request(app.getHttpServer()).get(url).expect(200);

    expect(res.body).toHaveLength(3);
    expect(res.body[0]).toMatchObject({ title: expect.any(String) });
  });

  it("serves nothing at the unprefixed root", async () => {
    await request(app.getHttpServer()).get("/").expect(404);
  });

  it("creates a todo and reads it back", async () => {
    const created = await request(app.getHttpServer())
      .post(url)
      .send({ title: "e2e todo", notes: "with notes" })
      .expect(201);

    expect(created.body).toMatchObject({
      title: "e2e todo",
      notes: "with notes",
      completed: false,
    });

    await request(app.getHttpServer())
      .get(`${url}/${created.body.id}`)
      .expect(200);
  });

  it("rejects a body carrying server-owned fields", async () => {
    const res = await request(app.getHttpServer())
      .post(url)
      .send({
        title: "spoofed",
        id: "attacker-chosen",
        createdAt: "1999-01-01",
      })
      .expect(400);

    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a title that is missing or too long", async () => {
    await request(app.getHttpServer()).post(url).send({}).expect(400);
    await request(app.getHttpServer())
      .post(url)
      .send({ title: "x".repeat(501) })
      .expect(400);
  });

  it("caps notes length so unbounded text cannot be stored", async () => {
    await request(app.getHttpServer())
      .post(url)
      .send({ title: "big", notes: "x".repeat(10_001) })
      .expect(400);
  });

  it("merges a partial update instead of clobbering the row", async () => {
    const created = await request(app.getHttpServer())
      .post(url)
      .send({ title: "keep title", notes: "keep notes" })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`${url}/${created.body.id}`)
      .send({ completed: true })
      .expect(200);

    expect(updated.body).toMatchObject({
      title: "keep title",
      notes: "keep notes",
      completed: true,
    });
  });

  it("strips notes for the free plan but not the paid plan", async () => {
    const created = await request(app.getHttpServer())
      .post(url)
      .send({ title: "plan check", notes: "secret" })
      .expect(201);

    const free = await request(app.getHttpServer())
      .get(`${url}/${created.body.id}?userRole=free`)
      .expect(200);
    const paid = await request(app.getHttpServer())
      .get(`${url}/${created.body.id}?userRole=paid`)
      .expect(200);

    expect(free.body.notes).toBeUndefined();
    expect(paid.body.notes).toBe("secret");
  });

  it("returns a stable error code for a missing todo", async () => {
    const res = await request(app.getHttpServer())
      .get(`${url}/does-not-exist`)
      .expect(404);

    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("deletes a todo", async () => {
    const created = await request(app.getHttpServer())
      .post(url)
      .send({ title: "temporary" })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`${url}/${created.body.id}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`${url}/${created.body.id}`)
      .expect(404);
  });
});
