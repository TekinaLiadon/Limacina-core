
export const getHash = async (url) => {
    const hasher = new Bun.CryptoHasher("md5");
    const readStream = Bun.file(url)
    const file = await readStream.stream()
    for await (const chunk of file) {
        hasher.update(chunk)
    }
    return hasher.digest("hex");
}