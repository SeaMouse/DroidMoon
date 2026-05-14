<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.12.1" name="tiles" tilewidth="32" tileheight="32" tilecount="800" columns="8">
 <image source="poc_tiles.png" width="256" height="3200"/>
 <tile id="0">
  <properties>
   <property name="obstacle" type="bool" value="true"/>
  </properties>
 </tile>
 <tile id="2">
  <properties>
   <property name="obstacle" type="bool" value="false"/>
  </properties>
 </tile>
 <tile id="9">
  <properties>
   <property name="obstacle" type="bool" value="true"/>
  </properties>
 </tile>
 <tile id="10">
  <properties>
   <property name="destroyedIndex" type="int" value="2"/>
   <property name="destructable" type="bool" value="true"/>
   <property name="obstacle" type="bool" value="true"/>
  </properties>
 </tile>
</tileset>
