import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const calculators = ["starforce", "potential", "ability", "add-option", "scroll", "pet", "soul"];

test("이용 안내에서 공개 계산기별 정적 사용법과 계산기로 이동할 수 있다", async () => {
  const hub = await read("guide/index.html");
  for (const id of calculators) {
    assert.ok(hub.includes(`href="/guide/${id}/"`), `${id}: 허브 링크`);
    const html = await read(`guide/${id}/index.html`);
    assert.ok(html.includes(`href="https://starforce.pages.dev/guide/${id}/"`), `${id}: canonical`);
    const calculator = id === "starforce" ? "/" : `/${id}/`;
    assert.ok(html.includes(`href="${calculator}"`), `${id}: 계산기 열기`);
    assert.match(html, /<article class="usage-article"[^>]*>/u);
    assert.doesNotMatch(html, /<article[^>]*\bhidden\b/u);
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]));
    for (const [, anchor] of html.matchAll(/href="#([^"]+)"/gu)) {
      assert.ok(ids.has(anchor), `${id}: 사용 순서 #${anchor}`);
    }
  }
  assert.doesNotMatch(hub, /href="\/guide\/item-market/u);
});

test("모든 사용법 이미지의 파일·크기·대체 설명이 실제 자료와 일치한다", async () => {
  for (const id of calculators) {
    const html = await read(`guide/${id}/index.html`);
    const figures = [...html.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gu)];
    assert.ok(figures.length >= 2, `${id}: 단계별 이미지`);
    for (const [, figure] of figures) {
      const image = figure.match(/<img src="(\/guide-images\/[^"<>]+\.png)" alt="([^"]+)" width="(\d+)" height="(\d+)"/u);
      assert.ok(image, `${id}: 이미지와 대체 설명·크기`);
      const [, path, alt, width, height] = image;
      assert.ok(alt.trim().length > 10);
      const data = await readFile(new URL(`public${path}`, root));
      assert.equal(data.readUInt32BE(16), Number(width), path);
      assert.equal(data.readUInt32BE(20), Number(height), path);
      assert.ok(figure.includes(`href="${path}"`), `${path}: 원본 크게 보기`);
      assert.match(figure, /<figcaption>[^<]+/u);
    }
  }
});

test("공통 이용 안내는 별도 페이지에서 제공하고 소개·문의와 계산기에 중복하지 않는다", async () => {
  const about = await read("about/index.html");
  assert.doesNotMatch(about, /<h2>제공하는 계산기<\/h2>|<section id="usage">/u);
  assert.match(about, /<h1>소개·문의<\/h1>/u);
  assert.match(await read("partials/site-footer.html"), /href="\/guide\/"/u);
  for (const id of calculators) {
    const html = await read(id === "starforce" ? "index.html" : `${id}/index.html`);
    assert.doesNotMatch(html, /calculator-guide|href="\/about\/#usage"/u);
    assert.match(html, /<!-- site-footer -->/u);
  }
});
