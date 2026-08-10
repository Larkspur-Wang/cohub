process.on("SIGTERM", () => {
  process.stdout.write("forwarded\n");
  process.exit(23);
});

process.stdout.write("ready\n");
setInterval(() => {}, 1000);
