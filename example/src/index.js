import { Plugins, FilesystemDirectory, Capacitor } from '@capacitor/core'
const { Filesystem } = Plugins

// import directly, instead of using Capacitor.Plugins
// see https://capacitor.ionicframework.com/docs/plugins/js/
import { writeFile } from '../../dist/plugin.mjs'

const output = document.createElement('pre')
document.body.innerHTML = ''
document.body.appendChild(output)

function log (msg) {
  output.innerHTML += `${msg}\n`
}

function arrayBufferToBase64(buffer) {
  var binary = '';
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function compareBlobs(...blobs) {
  const buffers = await Promise.all(
    blobs.map(
      // read blobs as ArrayBuffers
      blob => new Response(blob).arrayBuffer()
    )
  )

  const views = buffers.map(buffer => new DataView(buffer))

  views.reduce((a, b) => {
    if (a.byteLength !== b.byteLength) {
      throw new Error('buffer lengths differ')
    }

    for (let i = 0; i < a.byteLength; i++) {
      if (a.getInt8(i) !== b.getInt8(i)) {
        throw new Error('buffers differ')
      }
    }

    return b
  })
}

// make a blob of random binary data, takes a while
function makeRandomBlob(byteLength) {
  const buffer = new ArrayBuffer(byteLength)
  const view = new DataView(buffer)
  let position = 0

  while(position < buffer.byteLength) {
    const val = Math.floor(256 * Math.random())
    view.setInt8(position, val)
    position += 1
  }

  return new Blob([buffer], { type: 'application/octet-stream' })
}

// makes a blob of uniform data, faster than makeRandomBlob
function makeUniformBlob(byteLength) {
  let blob = new Blob([])

  // avoid running out of memory by gradually increasing the size of the blob,
  // which can flush to disk
  const maxChunkSize = 10 * 1024 * 1024
  let position = 0
  while (position < byteLength) {
    const size = Math.min(maxChunkSize, byteLength - position)
    const bytes = new Uint8Array(size).fill(0)

    blob = new Blob([blob, bytes.buffer], { type: 'application/octet-stream' })

    position += maxChunkSize
  }

  if (blob.size !== byteLength) {
    throw new Error('length mismatch')
  }

  return blob
}

async function testWrite({
  path = `${Math.random()}.bin`,
  blob = makeRandomBlob(10),
  directory = FilesystemDirectory.Data,
}) {
  // write
  const start = Date.now()
  const { uri } = await writeFile({ path, directory, data: blob })
  log(`wrote ${blob.size} bytes in ${Date.now() - start}ms`)

  // read
  const fileURL = Capacitor.convertFileSrc(uri)
  const fileResponse = await fetch(fileURL)

  const fileBlob = await fileResponse.blob()

  // compare
  await compareBlobs(blob, fileBlob)
}

async function runTests() {
  log('starting tests')

  // non-existant file
  const now = Date.now()
  await testWrite({ path: `${now}.txt` })

  // overwrite file
  await testWrite({ path: `${now}.txt` })

  // alternate directory
  await testWrite({ directory: FilesystemDirectory.Cache })

  // write multiple files concurrently
  await Promise.all([
    testWrite({}),
    testWrite({}),
    testWrite({}),
  ])

  // write larger file to force multiple chunks e.g. when streaming to disk
  await testWrite({ blob: makeRandomBlob(5 * 1024 * 1024) })

  log('tests passed!')
}

async function runBenchmark() {
  log('starting benchmark')

  for (const plugin of ['BlobWriter', 'Filesystem']) {
    const maxSize = 256 * 1024 * 1024

    let byteLength = 1

    while (byteLength <= maxSize) {
      const blob = makeUniformBlob(byteLength)

      const start = Date.now()
      const path = `${Math.random()}.bin`
      const directory = FilesystemDirectory.Data

      if (plugin === 'Filesystem') {
        // read blob as array buffer
        const buffer = await new Response(blob).arrayBuffer()

        await Filesystem.writeFile({
          path,
          directory,
          data: arrayBufferToBase64(buffer),
        })
      } else if (plugin === 'BlobWriter') {
        await writeFile({
          path,
          directory,
          data: blob,
        })
      }

      log(`${plugin} wrote ${byteLength} in ${Date.now() - start}ms`)

      // exponentially increase data size
      byteLength *= 2
    }
  }

  log('benchmark finished')
}

async function runAll() {
  await runTests()

  // benchmarks generally cause a crash :)
  // await runBenchmark()
}

runAll().catch(err => {
  console.error(err)
  log(err.message)
  log(err.stack)
})