Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/") {
    const file = await Deno.open("../dist/main/index.html", { read: true });
    return new Response(file.readable);
  }

  const filepath = decodeURIComponent(url.pathname);

  try {
    const file = await Deno.open("../dist/main/" + filepath, { read: true });
    return new Response(file.readable);
  } catch {
    return new Response("404 Not Found", { status: 404 });
  }
});
