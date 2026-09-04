import os
from pathlib import Path

from fastapi.responses import PlainTextResponse

from app.web import create_app


APP_ROOT = Path(__file__).parent
PORT = int(os.environ.get("PORT", "8420"))
HOST = os.environ.get("HOST", "127.0.0.1")

app = create_app(
    data_root=APP_ROOT / "data",
    static_root=APP_ROOT / "static",
)


@app.get("/starter-readme")
async def starter_readme():
    return PlainTextResponse((APP_ROOT / "README.md").read_text())


if __name__ == "__main__":
    import uvicorn

    print(f"\n  Scrubdata Starter App: http://{HOST}:{PORT}\n")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
