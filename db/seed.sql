insert into stores (id, name, address, district, opening_hours, lat, lng) values
  ('st_1', 'Kiez Markt Kreuzberg', 'Oranienstrasse 164, 10969 Berlin', 'Kreuzberg', 'Mo-Sa 08:00-22:00', 52.5006, 13.4034),
  ('st_2', 'Bio Eck Prenzlauer Berg', 'Schoenhauser Allee 142, 10437 Berlin', 'Prenzlauer Berg', 'Mo-Sa 09:00-21:00', 52.5406, 13.4123),
  ('st_3', 'Friedrichshain Kiosk Plus', 'Warschauer Strasse 37, 10243 Berlin', 'Friedrichshain', 'Mo-So 10:00-23:00', 52.5051, 13.4476)
on conflict (id) do nothing;

insert into products (id, normalized_name, brand, category) values
  ('pr_1', 'hafermilch 1l', 'Oatly', 'getraenke'),
  ('pr_2', 'pasta fusilli 500g', 'Barilla', 'lebensmittel'),
  ('pr_3', 'zahnpasta sensitive', 'Elmex', 'drogerie')
on conflict (id) do nothing;

insert into offers (id, store_id, product_id, price_optional, availability, updated_at) values
  ('of_1', 'st_1', 'pr_1', 2.49, 'in_stock', now() - interval '3 hours'),
  ('of_2', 'st_2', 'pr_1', 2.29, 'low_stock', now() - interval '6 hours'),
  ('of_3', 'st_3', 'pr_2', 1.99, 'in_stock', now() - interval '24 hours'),
  ('of_4', 'st_1', 'pr_3', null, 'in_stock', now() - interval '30 hours')
on conflict (id) do nothing;
