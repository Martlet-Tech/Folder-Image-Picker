import os
import hashlib
import numpy as np
import torch
from PIL import Image, ImageOps
from aiohttp import web
from server import PromptServer

NODE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(NODE_DIR, "thumb_cache")
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}

os.makedirs(CACHE_DIR, exist_ok=True)


def _abspath(path):
    return os.path.normpath(os.path.abspath(path))


def _resolve(folder, rel):
    root = _abspath(folder)
    target = _abspath(os.path.join(root, rel)) if rel else root
    if target != root and not target.startswith(root + os.sep):
        return None
    return target


def _join_rel(prefix, sub):
    sub = sub.replace("\\", "/") if sub else ""
    if not prefix:
        return sub
    return f"{prefix}/{sub}" if sub else prefix


def _scan(folder, rel, recursive):
    base = _resolve(folder, rel)
    if base is None or not os.path.isdir(base):
        return None
    prefix = (rel or "").replace("\\", "/").strip("/")
    folders = []
    images = []
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d != "thumb_cache")
        current = os.path.relpath(dirpath, base)
        if current == ".":
            current = ""
        for d in dirnames:
            folders.append(_join_rel(prefix, _join_rel(current, d)))
        for f in sorted(filenames):
            if os.path.splitext(f)[1].lower() not in IMAGE_EXTENSIONS:
                continue
            full = os.path.join(dirpath, f)
            try:
                stat = os.stat(full)
                size = stat.st_size
                mtime = stat.st_mtime
            except OSError:
                size = 0
                mtime = 0
            images.append({
                "name": f,
                "rel": _join_rel(prefix, _join_rel(current, f)),
                "size": size,
                "mtime": mtime,
            })
        if not recursive:
            dirnames[:] = []
    return folders, images


def _thumb_path(full_path, mtime):
    key = f"{full_path}|{int(mtime)}"
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()
    return os.path.join(CACHE_DIR, digest + ".webp")


def _make_thumb(full_path, mtime, max_size=320):
    target = _thumb_path(full_path, mtime)
    if os.path.exists(target):
        return target
    try:
        img = Image.open(full_path)
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
        img.thumbnail((max_size, max_size), Image.LANCZOS)
        img.save(target, "WEBP", quality=82, method=4)
        return target
    except Exception as exc:
        print(f"FolderImagePicker: thumbnail failed for {full_path}: {exc}")
        return None


@PromptServer.instance.routes.get("/folderpicker/list")
async def folderpicker_list(request):
    folder = request.query.get("folder", "")
    rel = request.query.get("rel", "")
    recursive = request.query.get("recursive", "0") == "1"

    if not folder:
        return web.json_response({"error": "folder is required"}, status=400)
    if not os.path.isdir(_abspath(folder)):
        return web.json_response({"error": "folder not found", "folder": folder}, status=404)

    result = _scan(folder, rel, recursive)
    if result is None:
        return web.json_response({"error": "invalid path"}, status=403)

    folders, images = result
    return web.json_response({
        "folder": _abspath(folder),
        "rel": rel,
        "recursive": recursive,
        "folders": folders,
        "images": images,
        "count": len(images),
    })


@PromptServer.instance.routes.get("/folderpicker/thumb")
async def folderpicker_thumb(request):
    folder = request.query.get("folder", "")
    rel = request.query.get("rel", "")
    if not folder or not rel:
        return web.Response(status=400, text="folder and rel are required")

    full = _resolve(folder, rel)
    if full is None:
        return web.Response(status=403, text="access denied")
    if not os.path.isfile(full):
        return web.Response(status=404, text="not found")

    try:
        mtime = os.stat(full).st_mtime
    except OSError:
        mtime = 0

    thumb = _make_thumb(full, mtime)
    if thumb and os.path.exists(thumb):
        return web.FileResponse(thumb, headers={"Cache-Control": "public, max-age=86400"})
    return web.FileResponse(full)


@PromptServer.instance.routes.post("/folderpicker/pick")
async def folderpicker_pick(request):
    payload = await request.json()
    start = payload.get("start", "")
    script = os.path.join(NODE_DIR, "pick_folder.ps1")
    if not os.path.exists(script):
        return web.json_response({"path": ""})
    import asyncio
    import subprocess

    def run():
        try:
            proc = subprocess.run(
                ["powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", script, "-Start", start],
                capture_output=True,
                text=True,
                timeout=300,
            )
            return proc.stdout.strip()
        except Exception as exc:
            print(f"FolderImagePicker: folder dialog failed: {exc}")
            return ""

    try:
        out = await asyncio.get_event_loop().run_in_executor(None, run)
    except Exception:
        out = ""
    path = out.splitlines()[-1].strip() if out else ""
    return web.json_response({"path": path})


class FolderImagePicker:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder": ("STRING", {"default": "", "multiline": False}),
                "selected_image": ("STRING", {"default": "", "multiline": False}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "load_image"
    CATEGORY = "image"

    @classmethod
    def IS_CHANGED(cls, folder="", selected_image="", **kwargs):
        if not folder or not selected_image:
            return ""
        full = _resolve(folder, selected_image)
        if full and os.path.isfile(full):
            try:
                return f"{full}:{os.stat(full).st_mtime}"
            except OSError:
                return full
        return f"{folder}:{selected_image}"

    @classmethod
    def VALIDATE_INPUTS(cls, folder="", selected_image="", **kwargs):
        return True

    def load_image(self, folder="", selected_image=""):
        blank = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
        if not folder or not selected_image:
            print("FolderImagePicker: no image selected")
            return (blank,)

        full = _resolve(folder, selected_image)
        if full is None or not os.path.isfile(full):
            print(f"FolderImagePicker: image not found: {selected_image}")
            return (blank,)

        try:
            img = Image.open(full)
            img = ImageOps.exif_transpose(img)
            if img.mode == "I":
                img = img.point(lambda i: i * (1 / 255))
            img = img.convert("RGB")
            arr = np.array(img).astype(np.float32) / 255.0
            return (torch.from_numpy(arr).unsqueeze(0),)
        except Exception as exc:
            print(f"FolderImagePicker: failed to load {full}: {exc}")
            return (blank,)


NODE_CLASS_MAPPINGS = {
    "FolderImagePicker": FolderImagePicker,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FolderImagePicker": "Folder Image Picker",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
