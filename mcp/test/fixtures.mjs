import { deflateSync } from "node:zlib";
import { createCanvas } from "@napi-rs/canvas";
import { MyboxClient } from "../dist/core.mjs";

export function mixedPdf() {
  const canvas = createCanvas(600, 600), context = canvas.getContext("2d");
  context.fillStyle = "white"; context.fillRect(0, 0, 600, 600);
  context.fillStyle = "black"; context.font = "bold 32px sans-serif";
  context.fillText("Math worksheet", 40, 80);
  context.font = "28px sans-serif"; context.fillText("f(x) = x^2 + 3x", 40, 160); context.fillText("Find f'(2).", 40, 230);
  context.strokeStyle = "#087e43"; context.lineWidth = 4; context.strokeRect(40, 300, 400, 150);
  const rgba = context.getImageData(0, 0, 600, 600).data, rgb = Buffer.alloc(600 * 600 * 3);
  for (let i = 0; i < 600 * 600; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
  const compressed = deflateSync(rgb);
  const stream = (body, extra = "") => Buffer.concat([Buffer.from(`<< /Length ${body.length} ${extra} >>\nstream\n`), body, Buffer.from("\nendstream")]);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    stream(Buffer.from("BT /F1 12 Tf 30 240 Td (Hello derivative problem 123) Tj ET")),
    stream(Buffer.from("q 300 0 0 300 0 0 cm /Im1 Do Q")),
    stream(compressed, "/Type /XObject /Subtype /Image /Width 600 /Height 600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode"),
  ];
  let position = 9; const offsets = [0], chunks = [Buffer.from("%PDF-1.4\n")];
  for (const [index, object] of objects.entries()) {
    offsets.push(position);
    const data = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    chunks.push(data); position += data.length;
  }
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF`;
  chunks.push(Buffer.from(xref)); return Buffer.concat(chunks);
}

export function mockClient(name, bytes, { size = bytes.length, responseFactory } = {}) {
  const meta = { resourceId: "fixture", name, size, type: "file" }, calls = [];
  const transport = async (raw, init = {}) => {
    const url = new URL(raw); calls.push({ url, init });
    if (url.hostname === "open-api.mybox.naver.com") {
      if (url.pathname.endsWith("/download")) return Response.json({ downloadUrl: "https://download.mybox.naver.com/fixture" });
      if (url.pathname.endsWith("/storage")) return Response.json({ usedSize: 123, totalSize: 456 });
      if (url.pathname.includes("search") || url.pathname.endsWith("/resources")) return Response.json({ resources: [meta], responseMetaData: {} });
      return Response.json(meta);
    }
    if (url.hostname === "download.mybox.naver.com") return responseFactory ? responseFactory() : new Response(bytes);
    throw new Error("Unexpected host");
  };
  return { client: new MyboxClient("mbx_pat_fixture_1234567890", transport), calls, meta };
}
