@echo off
set PM2_HOME=C:\Users\BJM\.pm2
set PATH=%PATH%;C:\Program Files\nodejs;C:\Users\BJM\AppData\Roaming\npm
cd C:\Users\BJM\wa-evi
call pm2 resurrect
