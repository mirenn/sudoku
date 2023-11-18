cd C:\Users\ngihy\Desktop\sudokuonline\sudokubackend
npm run build
cd C:\Users\ngihy\Desktop\sudokuonline\sudokufrontend
npm run build
cd ../
Copy-Item sudokubackend/dist/* sudokubackend/ -Recurse -Force
cd sudokubackend
Compress-Archive -Path * -DestinationPath uploadnodeserver.zip -Force
az webapp deploy --resource-group nagairesource --name sudokunagai --src-path uploadnodeserver.zip
cd C:\Users\ngihy\Desktop\sudokuonline\