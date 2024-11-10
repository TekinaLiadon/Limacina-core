import fs from "node:fs";
import path from "node:path";
export var list = {
  files: {},
};
export async function routerList() {
  var filesList = [];
  async function readDirAsync(dir) {
    let files = [];

    const contents = await fs.promises.readdir(dir);

    for (const item of contents) {
      const path = `${dir}/${item}`;
      const stat = await fs.promises.stat(path);

      if (stat.isFile()) {
        files.push(item);
      } else if (stat.isDirectory()) {
        const subFiles = await readDirAsync(path);
        files = files.concat(subFiles);
      }
    }

    return files;
  }

  await Promise.all([
    readDirAsync(
      path.join(path.join(path.dirname(__filename), ".."), "02-routes", "files")
    ),
  ])
    .then((files) => {
      filesList = files[0];
    })
    .catch((error) => console.error(error));

  for (const name of filesList) {
    list.files[name.replace(".ts", "")] = await import(
      `../02-routes/files/${name}`
    );
  }

  Object.freeze(list);
}
