@echo off
rem ATLAS: start the app and the share link when you sign in to Windows.
rem To turn it on, copy this file into your Startup folder (press Win+R, type shell:startup, press Enter).
rem To turn it off, delete it from that folder.
cd /d "C:\Users\anant\Desktop\Atlas"
node scripts\atlas.mjs start >> .atlas\logs\autostart.log 2>&1
node scripts\share.mjs start >> .atlas\logs\autostart.log 2>&1
