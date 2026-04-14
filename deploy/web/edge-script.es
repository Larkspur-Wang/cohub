# ========================================
# Aliyun CDN EdgeScript
# 1. Directory paths → rewrite to index.html
# 2. Content-Type header injection by file extension
# ========================================

# ===== Rewrite directory URIs to index.html =====
# Handles both the internal rewrite and Content-Type in one step,
# since rewrite() may not update $uri for subsequent variable reads.
if and(match_re($uri, '/$'), not(eq($uri, '/'))) {
    add_rsp_header('Content-Type', 'text/html; charset=utf-8')
    rewrite(concat($uri, 'index.html'), 'break')
}

# u is derived from the original $uri
u = lower($uri)

# ===== Content-Type: text types =====
def set_text_types() {
    if or(match_re(u, '\\.html$'), match_re(u, '\\.htm$')) {
        add_rsp_header('Content-Type', 'text/html; charset=utf-8')
        return true
    }

    if match_re(u, '\\.shtml$') {
        add_rsp_header('Content-Type', 'text/html; charset=utf-8')
        return true
    }

    if match_re(u, '\\.css$') {
        add_rsp_header('Content-Type', 'text/css; charset=utf-8')
        return true
    }

    if or(match_re(u, '\\.js$'), match_re(u, '\\.mjs$')) {
        add_rsp_header('Content-Type', 'application/javascript; charset=utf-8')
        return true
    }

    if match_re(u, '\\.cjs$') {
        add_rsp_header('Content-Type', 'application/javascript; charset=utf-8')
        return true
    }

    if match_re(u, '\\.map$') {
        add_rsp_header('Content-Type', 'application/json; charset=utf-8')
        return true
    }

    if match_re(u, '\\.json$') {
        add_rsp_header('Content-Type', 'application/json; charset=utf-8')
        return true
    }

    if match_re(u, '\\.jsonld$') {
        add_rsp_header('Content-Type', 'application/ld+json; charset=utf-8')
        return true
    }

    if match_re(u, '\\.webmanifest$') {
        add_rsp_header('Content-Type', 'application/manifest+json; charset=utf-8')
        return true
    }

    if match_re(u, '\\.xml$') {
        add_rsp_header('Content-Type', 'application/xml; charset=utf-8')
        return true
    }

    if match_re(u, '\\.txt$') {
        add_rsp_header('Content-Type', 'text/plain; charset=utf-8')
        return true
    }

    if match_re(u, '\\.md$') {
        add_rsp_header('Content-Type', 'text/markdown; charset=utf-8')
        return true
    }

    if match_re(u, '\\.csv$') {
        add_rsp_header('Content-Type', 'text/csv; charset=utf-8')
        return true
    }

    if match_re(u, '\\.tsv$') {
        add_rsp_header('Content-Type', 'text/tab-separated-values; charset=utf-8')
        return true
    }

    if or(match_re(u, '\\.yaml$'), match_re(u, '\\.yml$')) {
        add_rsp_header('Content-Type', 'application/yaml; charset=utf-8')
        return true
    }

    if match_re(u, '\\.toml$') {
        add_rsp_header('Content-Type', 'application/toml; charset=utf-8')
        return true
    }

    if or(match_re(u, '\\.ini$'), match_re(u, '\\.log$')) {
        add_rsp_header('Content-Type', 'text/plain; charset=utf-8')
        return true
    }

    if match_re(u, '\\.rtf$') {
        add_rsp_header('Content-Type', 'application/rtf')
        return true
    }

    if match_re(u, '\\.pdf$') {
        add_rsp_header('Content-Type', 'application/pdf')
        return true
    }

    if match_re(u, '\\.epub$') {
        add_rsp_header('Content-Type', 'application/epub+zip')
        return true
    }

    if match_re(u, '/manifest\\.json$') {
        add_rsp_header('Content-Type', 'application/manifest+json; charset=utf-8')
        return true
    }

    if or(match_re(u, '/sitemap\\.xml$'), match_re(u, '/feed\\.xml$')) {
        add_rsp_header('Content-Type', 'application/xml; charset=utf-8')
        return true
    }

    if or(match_re(u, '/robots\\.txt$'), match_re(u, '/humans\\.txt$')) {
        add_rsp_header('Content-Type', 'text/plain; charset=utf-8')
        return true
    }

    if or(match_re(u, '/security\\.txt$'), match_re(u, '/ads\\.txt$')) {
        add_rsp_header('Content-Type', 'text/plain; charset=utf-8')
        return true
    }

    return false
}

# ===== Content-Type: image types =====
def set_image_types() {
    if match_re(u, '\\.svg$') {
        add_rsp_header('Content-Type', 'image/svg+xml')
        return true
    }

    if match_re(u, '\\.png$') {
        add_rsp_header('Content-Type', 'image/png')
        return true
    }

    if or(match_re(u, '\\.jpg$'), match_re(u, '\\.jpeg$')) {
        add_rsp_header('Content-Type', 'image/jpeg')
        return true
    }

    if match_re(u, '\\.gif$') {
        add_rsp_header('Content-Type', 'image/gif')
        return true
    }

    if match_re(u, '\\.webp$') {
        add_rsp_header('Content-Type', 'image/webp')
        return true
    }

    if match_re(u, '\\.avif$') {
        add_rsp_header('Content-Type', 'image/avif')
        return true
    }

    if match_re(u, '\\.apng$') {
        add_rsp_header('Content-Type', 'image/apng')
        return true
    }

    if match_re(u, '\\.bmp$') {
        add_rsp_header('Content-Type', 'image/bmp')
        return true
    }

    if or(match_re(u, '\\.ico$'), match_re(u, '\\.cur$')) {
        add_rsp_header('Content-Type', 'image/x-icon')
        return true
    }

    if or(match_re(u, '\\.tif$'), match_re(u, '\\.tiff$')) {
        add_rsp_header('Content-Type', 'image/tiff')
        return true
    }

    if match_re(u, '\\.heic$') {
        add_rsp_header('Content-Type', 'image/heic')
        return true
    }

    if match_re(u, '\\.heif$') {
        add_rsp_header('Content-Type', 'image/heif')
        return true
    }

    return false
}

# ===== Content-Type: font types =====
def set_font_types() {
    if match_re(u, '\\.woff2$') {
        add_rsp_header('Content-Type', 'font/woff2')
        return true
    }

    if match_re(u, '\\.woff$') {
        add_rsp_header('Content-Type', 'font/woff')
        return true
    }

    if match_re(u, '\\.ttf$') {
        add_rsp_header('Content-Type', 'font/ttf')
        return true
    }

    if match_re(u, '\\.otf$') {
        add_rsp_header('Content-Type', 'font/otf')
        return true
    }

    if match_re(u, '\\.eot$') {
        add_rsp_header('Content-Type', 'application/vnd.ms-fontobject')
        return true
    }

    return false
}

# ===== Content-Type: audio & video types =====
def set_audio_video_types() {
    if match_re(u, '\\.mp3$') {
        add_rsp_header('Content-Type', 'audio/mpeg')
        return true
    }

    if match_re(u, '\\.wav$') {
        add_rsp_header('Content-Type', 'audio/wav')
        return true
    }

    if or(match_re(u, '\\.ogg$'), match_re(u, '\\.oga$')) {
        add_rsp_header('Content-Type', 'audio/ogg')
        return true
    }

    if match_re(u, '\\.m4a$') {
        add_rsp_header('Content-Type', 'audio/mp4')
        return true
    }

    if match_re(u, '\\.aac$') {
        add_rsp_header('Content-Type', 'audio/aac')
        return true
    }

    if match_re(u, '\\.flac$') {
        add_rsp_header('Content-Type', 'audio/flac')
        return true
    }

    if match_re(u, '\\.opus$') {
        add_rsp_header('Content-Type', 'audio/opus')
        return true
    }

    if match_re(u, '\\.weba$') {
        add_rsp_header('Content-Type', 'audio/webm')
        return true
    }

    if or(match_re(u, '\\.mp4$'), match_re(u, '\\.m4v$')) {
        add_rsp_header('Content-Type', 'video/mp4')
        return true
    }

    if match_re(u, '\\.webm$') {
        add_rsp_header('Content-Type', 'video/webm')
        return true
    }

    if match_re(u, '\\.mov$') {
        add_rsp_header('Content-Type', 'video/quicktime')
        return true
    }

    if match_re(u, '\\.avi$') {
        add_rsp_header('Content-Type', 'video/x-msvideo')
        return true
    }

    if match_re(u, '\\.mkv$') {
        add_rsp_header('Content-Type', 'video/x-matroska')
        return true
    }

    if match_re(u, '\\.ogv$') {
        add_rsp_header('Content-Type', 'video/ogg')
        return true
    }

    if match_re(u, '\\.3gp$') {
        add_rsp_header('Content-Type', 'video/3gpp')
        return true
    }

    if match_re(u, '\\.3g2$') {
        add_rsp_header('Content-Type', 'video/3gpp2')
        return true
    }

    if match_re(u, '\\.ts$') {
        add_rsp_header('Content-Type', 'video/mp2t')
        return true
    }

    if match_re(u, '\\.m3u8$') {
        add_rsp_header('Content-Type', 'application/vnd.apple.mpegurl')
        return true
    }

    return false
}

# ===== Content-Type: binary types =====
def set_binary_types() {
    if match_re(u, '\\.zip$') {
        add_rsp_header('Content-Type', 'application/zip')
        return true
    }

    if or(match_re(u, '\\.gz$'), match_re(u, '\\.tgz$')) {
        add_rsp_header('Content-Type', 'application/gzip')
        return true
    }

    if match_re(u, '\\.bz2$') {
        add_rsp_header('Content-Type', 'application/x-bzip2')
        return true
    }

    if match_re(u, '\\.xz$') {
        add_rsp_header('Content-Type', 'application/x-xz')
        return true
    }

    if match_re(u, '\\.7z$') {
        add_rsp_header('Content-Type', 'application/x-7z-compressed')
        return true
    }

    if match_re(u, '\\.rar$') {
        add_rsp_header('Content-Type', 'application/vnd.rar')
        return true
    }

    if match_re(u, '\\.tar$') {
        add_rsp_header('Content-Type', 'application/x-tar')
        return true
    }

    if match_re(u, '\\.wasm$') {
        add_rsp_header('Content-Type', 'application/wasm')
        return true
    }

    if match_re(u, '\\.bin$') {
        add_rsp_header('Content-Type', 'application/octet-stream')
        return true
    }

    if match_re(u, '\\.apk$') {
        add_rsp_header('Content-Type', 'application/vnd.android.package-archive')
        return true
    }

    if match_re(u, '\\.exe$') {
        add_rsp_header('Content-Type', 'application/vnd.microsoft.portable-executable')
        return true
    }

    if match_re(u, '\\.dmg$') {
        add_rsp_header('Content-Type', 'application/x-apple-diskimage')
        return true
    }

    if match_re(u, '\\.iso$') {
        add_rsp_header('Content-Type', 'application/x-iso9660-image')
        return true
    }

    if match_re(u, '\\.doc$') {
        add_rsp_header('Content-Type', 'application/msword')
        return true
    }

    if match_re(u, '\\.docx$') {
        add_rsp_header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        return true
    }

    if match_re(u, '\\.xls$') {
        add_rsp_header('Content-Type', 'application/vnd.ms-excel')
        return true
    }

    if match_re(u, '\\.xlsx$') {
        add_rsp_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        return true
    }

    if match_re(u, '\\.ppt$') {
        add_rsp_header('Content-Type', 'application/vnd.ms-powerpoint')
        return true
    }

    if match_re(u, '\\.pptx$') {
        add_rsp_header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
        return true
    }

    return false
}

# ===== Execute Content-Type rules =====
set_text_types()
set_image_types()
set_font_types()
set_audio_video_types()
set_binary_types()
