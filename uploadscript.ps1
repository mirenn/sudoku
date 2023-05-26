rm nodeserver.zip
rm index.js
npm run build
mv .\dist\index.js ./
Compress-Archive -Path * -DestinationPath nodeserver.zip
az webapp deploy --resource-group nagairesource --name sudokunagai --src-path C:\Users\ngihy\Desktop\nodeserver\nodeserver.zip